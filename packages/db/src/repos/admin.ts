import { count, desc, eq, gte, ilike, isNotNull, max, or, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type AdminAuditEntry,
  adminAudit,
  aiUsageDaily,
  projects,
  receipts,
  users,
  waitlist,
} from "../schema";

// The admin section (2026-11-01). Counts and metadata only: never receipt contents, source code or token values.

const DAY_MS = 86_400_000;
export const ADMIN_PAGE = 50;
export const MAX_AUDIT = 200;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** The last `n` UTC days, oldest first, ending today. */
export function lastDays(now: Date, n: number): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: n }, (_, i) => isoDay(new Date(today - (n - 1 - i) * DAY_MS)));
}

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  suspendedAt: Date | null;
  projects: number;
  receipts: number;
  lastActivity: Date | null;
};

export const adminRepo = {
  /** The database answers (admin health). */
  async ping(db: BrainDb): Promise<boolean> {
    try {
      await db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  },

  async overview(db: BrainDb, now: Date) {
    const days = lastDays(now, 30);
    const since = new Date(`${days[0]}T00:00:00.000Z`);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const [[u], [p], [w], perDay, [active]] = await Promise.all([
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(projects),
      db.select({ n: count() }).from(waitlist),
      db
        .select({
          day: sql<string>`to_char(${receipts.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
          n: count(),
        })
        .from(receipts)
        .where(gte(receipts.createdAt, since))
        .groupBy(sql`1`),
      db
        .select({ n: sql<number>`count(distinct ${receipts.projectId})::int` })
        .from(receipts)
        .where(gte(receipts.createdAt, weekAgo)),
    ]);
    const byDay = new Map(perDay.map((r) => [r.day, Number(r.n)]));
    return {
      users: u?.n ?? 0,
      projects: p?.n ?? 0,
      waitlist: w?.n ?? 0,
      activeProjects7d: active?.n ?? 0,
      receiptsPerDay: days.map((day) => ({ day, receipts: byDay.get(day) ?? 0 })),
    };
  },

  /** Users, newest first, with counts; `search` matches name or email (case-insensitive, plain text). */
  async listUsers(
    db: BrainDb,
    opts: { search?: string; offset?: number } = {},
  ): Promise<{ rows: AdminUserRow[]; total: number }> {
    const q = (opts.search ?? "").trim().slice(0, 100);
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const where = q ? or(ilike(users.name, pattern), ilike(users.email, pattern)) : undefined;
    // Correlated subqueries written out in full: aliased tables keep every column unambiguous.
    const projectCount = sql<number>`(select count(*)::int from projects p where p.owner_id = "user"."id")`;
    const receiptCount = sql<number>`(select count(*)::int from receipts r join projects p on p.id = r.project_id where p.owner_id = "user"."id")`;
    const lastReceipt = sql<Date | null>`(select max(r.created_at) from receipts r join projects p on p.id = r.project_id where p.owner_id = "user"."id")`;
    const lastToken = sql<Date | null>`(select max(t.last_used_at) from project_tokens t join projects p on p.id = t.project_id where p.owner_id = "user"."id")`;
    const [rows, [n]] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          createdAt: users.createdAt,
          suspendedAt: users.suspendedAt,
          projects: projectCount,
          receipts: receiptCount,
          lastReceipt,
          lastToken,
        })
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(ADMIN_PAGE)
        .offset(Math.max(0, opts.offset ?? 0)),
      db.select({ n: count() }).from(users).where(where),
    ]);
    const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));
    return {
      total: n?.n ?? 0,
      rows: rows.map(({ lastReceipt: a, lastToken: b, ...r }) => {
        const times = [date(a), date(b)].filter((d): d is Date => d !== null);
        return {
          ...r,
          projects: Number(r.projects),
          receipts: Number(r.receipts),
          lastActivity: times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : null,
        };
      }),
    };
  },

  /** One user and their projects with receipt counts (never receipt contents). */
  async userDetail(db: BrainDb, userId: string) {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        createdAt: users.createdAt,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return null;
    const list = await db
      .select({
        id: projects.id,
        name: projects.name,
        repoFullName: projects.repoFullName,
        createdAt: projects.createdAt,
        suspendedAt: projects.suspendedAt,
        receipts: count(receipts.id),
        lastReceiptAt: max(receipts.createdAt),
      })
      .from(projects)
      .leftJoin(receipts, eq(receipts.projectId, projects.id))
      .where(eq(projects.ownerId, userId))
      .groupBy(projects.id)
      .orderBy(desc(projects.createdAt))
      .limit(100);
    return { user, projects: list.map((p) => ({ ...p, receipts: Number(p.receipts) })) };
  },

  /** AI calls per day and per project over the last `days` days. */
  async aiUsage(db: BrainDb, now: Date, days = 30) {
    const range = lastDays(now, days);
    const since = range[0] as string;
    const rows = await db
      .select({
        projectId: aiUsageDaily.projectId,
        projectName: projects.name,
        day: aiUsageDaily.day,
        calls: aiUsageDaily.calls,
      })
      .from(aiUsageDaily)
      .innerJoin(projects, eq(projects.id, aiUsageDaily.projectId))
      .where(gte(aiUsageDaily.day, since))
      .orderBy(desc(aiUsageDaily.day))
      .limit(5000);
    return { range, rows };
  },

  async setUserSuspended(db: BrainDb, userId: string, suspended: boolean): Promise<boolean> {
    const rows = await db
      .update(users)
      .set({ suspendedAt: suspended ? new Date() : null })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    return rows.length > 0;
  },

  async setProjectSuspended(db: BrainDb, projectId: string, suspended: boolean): Promise<boolean> {
    const rows = await db
      .update(projects)
      .set({ suspendedAt: suspended ? new Date() : null })
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id });
    return rows.length > 0;
  },

  /** Suspends or restores a user or project and writes its audit row in one transaction; false when not found. */
  async setSuspendedAudited(
    db: BrainDb,
    input: {
      targetType: "user" | "project";
      targetId: string;
      suspended: boolean;
      audit: Parameters<typeof adminAuditRepo.record>[1];
    },
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const t = tx as unknown as BrainDb;
      const changed =
        input.targetType === "user"
          ? await adminRepo.setUserSuspended(t, input.targetId, input.suspended)
          : await adminRepo.setProjectSuspended(t, input.targetId, input.suspended);
      if (changed) await adminAuditRepo.record(t, input.audit);
      return changed;
    });
  },

  /** Suspended users and projects, for the overview. */
  async suspendedCounts(db: BrainDb) {
    const [[u], [p]] = await Promise.all([
      db.select({ n: count() }).from(users).where(isNotNull(users.suspendedAt)),
      db.select({ n: count() }).from(projects).where(isNotNull(projects.suspendedAt)),
    ]);
    return { users: u?.n ?? 0, projects: p?.n ?? 0 };
  },
};

// The audit log: insert and list only (the table also refuses UPDATE and DELETE).
export const adminAuditRepo = {
  async record(
    db: BrainDb,
    entry: {
      adminUserId: string;
      adminLogin: string;
      action: string;
      targetType: string;
      targetId: string;
      detail?: string | null;
    },
  ): Promise<void> {
    await db.insert(adminAudit).values({ ...entry, detail: entry.detail ?? null });
  },

  async list(db: BrainDb, limit = MAX_AUDIT): Promise<AdminAuditEntry[]> {
    return db
      .select()
      .from(adminAudit)
      .orderBy(desc(adminAudit.createdAt), desc(adminAudit.id))
      .limit(Math.min(Math.max(1, limit), MAX_AUDIT));
  },
};

// AI calls per project per UTC day, kept beside the (pruned) daily budget counters.
export const aiUsageRepo = {
  async add(db: BrainDb, projectId: string, day: Date, n: number): Promise<void> {
    if (n === 0) return;
    await db
      .insert(aiUsageDaily)
      .values({ projectId, day: isoDay(day), calls: Math.max(0, n) })
      .onConflictDoUpdate({
        target: [aiUsageDaily.projectId, aiUsageDaily.day],
        set: { calls: sql`greatest(0, ${aiUsageDaily.calls} + ${n})` },
      });
  },
};
