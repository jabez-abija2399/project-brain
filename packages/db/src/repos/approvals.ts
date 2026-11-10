import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type ApprovalPolicyRow,
  type ApprovalRequestRow,
  approvalAudit,
  approvalPolicies,
  approvalRequests,
} from "../schema";

type Tx = Parameters<Parameters<BrainDb["transaction"]>[0]>[0];
export type ApprovalTx = Tx | BrainDb;

// Roadmap Phase 6a: approval policies, requests and the append-only audit log. Every read and write is scoped to the
// project; who may call which (owner or agent token) is decided by the server, never here.

export const approvalPoliciesRepo = {
  /**
   * Security review (Phase 6a): every read-change-write of a project's policy, and every new request, runs under one
   * per-project lock, so two changes never overwrite each other and the open-request limit holds.
   */
  async withLock<T>(db: BrainDb, projectId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`approvals:${projectId}`}, 0))`,
      );
      return fn(tx);
    });
  },

  async get(db: ApprovalTx, projectId: string): Promise<ApprovalPolicyRow | null> {
    const [row] = await db
      .select()
      .from(approvalPolicies)
      .where(eq(approvalPolicies.projectId, projectId));
    return row ?? null;
  },

  async upsert(
    db: ApprovalTx,
    projectId: string,
    data: Pick<ApprovalPolicyRow, "preset" | "rules" | "pausedUntil" | "updatedBy">,
  ): Promise<ApprovalPolicyRow> {
    const values = { ...data, projectId, updatedAt: new Date() };
    const [row] = await db
      .insert(approvalPolicies)
      .values(values)
      .onConflictDoUpdate({ target: approvalPolicies.projectId, set: values })
      .returning();
    if (!row) throw new Error("upsert approval_policies returned no row");
    return row;
  },
};

export const approvalRequestsRepo = {
  async insert(
    db: ApprovalTx,
    projectId: string,
    data: Omit<
      ApprovalRequestRow,
      "id" | "projectId" | "createdAt" | "undoneAt" | "decidedBy" | "decidedAt"
    > &
      Partial<Pick<ApprovalRequestRow, "decidedBy" | "decidedAt">>,
  ): Promise<ApprovalRequestRow> {
    const [row] = await db
      .insert(approvalRequests)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert approval_requests returned no row");
    return row;
  },

  async get(db: ApprovalTx, projectId: string, id: string): Promise<ApprovalRequestRow | null> {
    const [row] = await db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.projectId, projectId), eq(approvalRequests.id, id)));
    return row ?? null;
  },

  async list(
    db: ApprovalTx,
    projectId: string,
    status: ApprovalRequestRow["status"] | null,
    limit = 100,
  ) {
    return db
      .select()
      .from(approvalRequests)
      .where(
        status
          ? and(eq(approvalRequests.projectId, projectId), eq(approvalRequests.status, status))
          : eq(approvalRequests.projectId, projectId),
      )
      .orderBy(desc(approvalRequests.createdAt))
      .limit(limit);
  },

  /** Roadmap Phase 9: how many requests still wait on the owner (pending and not expired). */
  async countPending(db: ApprovalTx, projectId: string, now: Date): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.projectId, projectId),
          eq(approvalRequests.status, "pending"),
          gte(approvalRequests.expiresAt, now),
        ),
      );
    return Number(row?.n ?? 0);
  },

  /** Decides a still-pending, unexpired request; null when it was not pending (already decided or expired). */
  async decide(
    db: ApprovalTx,
    projectId: string,
    id: string,
    status: "approved" | "rejected",
    decidedBy: string,
    now: Date,
  ): Promise<ApprovalRequestRow | null> {
    const [row] = await db
      .update(approvalRequests)
      .set({ status, decidedBy, decidedAt: now })
      .where(
        and(
          eq(approvalRequests.projectId, projectId),
          eq(approvalRequests.id, id),
          eq(approvalRequests.status, "pending"),
          gte(approvalRequests.expiresAt, now),
        ),
      )
      .returning();
    return row ?? null;
  },

  /** Marks an automatic approval as undone (once); null when it was not an automatic one or is already undone. */
  async undo(db: ApprovalTx, projectId: string, id: string, now: Date) {
    const [row] = await db
      .update(approvalRequests)
      .set({ undoneAt: now })
      .where(
        and(
          eq(approvalRequests.projectId, projectId),
          eq(approvalRequests.id, id),
          eq(approvalRequests.status, "auto"),
          isNull(approvalRequests.undoneAt),
        ),
      )
      .returning();
    return row ?? null;
  },

  /** Finished requests (automatic, refused, expired, decided) older than `before` are removed; the audit log stays. */
  async prune(db: ApprovalTx, projectId: string, before: Date) {
    await db
      .delete(approvalRequests)
      .where(
        and(
          eq(approvalRequests.projectId, projectId),
          inArray(approvalRequests.status, ["auto", "never", "expired", "approved", "rejected"]),
          lt(approvalRequests.createdAt, before),
        ),
      );
  },

  /** Pending requests past their expiry become "expired" (nothing happens for them). */
  async expire(db: ApprovalTx, projectId: string, now: Date) {
    return db
      .update(approvalRequests)
      .set({ status: "expired", decidedAt: now })
      .where(
        and(
          eq(approvalRequests.projectId, projectId),
          eq(approvalRequests.status, "pending"),
          lt(approvalRequests.expiresAt, now),
        ),
      )
      .returning({ id: approvalRequests.id });
  },
};

export const approvalAuditRepo = {
  async append(
    db: ApprovalTx,
    projectId: string,
    entry: {
      event: string;
      requestId?: string | null;
      actorKind: "owner" | "agent" | "system";
      actorId?: string | null;
      detail?: Record<string, unknown>;
    },
  ) {
    await db.insert(approvalAudit).values({
      projectId,
      event: entry.event,
      requestId: entry.requestId ?? null,
      actorKind: entry.actorKind,
      actorId: entry.actorId ?? null,
      detail: entry.detail ?? {},
    });
  },

  async list(db: ApprovalTx, projectId: string, limit = 200) {
    return db
      .select()
      .from(approvalAudit)
      .where(eq(approvalAudit.projectId, projectId))
      .orderBy(desc(approvalAudit.createdAt))
      .limit(limit);
  },
};
