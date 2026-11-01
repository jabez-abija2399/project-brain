import { safeDisplay } from "@brain/core";
import { ADMIN_PAGE, type BrainDb, adminAuditRepo, adminRepo, waitlistRepo } from "@brain/db";
import { z } from "zod";
import type { Admin } from "./admin";
import { dailyAiBudget } from "./code-index-limits";
import { configuredServices } from "./env";
import { AppError } from "./errors";
import { rateLimit } from "./rate-limit";

// The admin section (2026-11-01): counts and metadata only. No source code is stored; no token value is ever read.
// Every function takes the Admin that requireAdmin returned, so none can run without the check.

/** Estimated cost of one AI call in US dollars (small model, a few thousand tokens); override with AI_COST_PER_CALL_USD. */
export function costPerCall(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.AI_COST_PER_CALL_USD);
  return Number.isFinite(v) && v >= 0 && v < 10 ? v : 0.003;
}

export async function health(db: BrainDb) {
  const database = await adminRepo.ping(db);
  const s = configuredServices(process.env);
  return {
    database,
    githubApp: s.githubApp,
    inngest: s.inngest,
    ai: s.ai,
    checkedAt: new Date().toISOString(),
  };
}

export async function adminOverview(_admin: Admin, db: BrainDb, now = new Date()) {
  const [o, suspended, h] = await Promise.all([
    adminRepo.overview(db, now),
    adminRepo.suspendedCounts(db),
    health(db),
  ]);
  return { ...o, suspended, health: h };
}

export async function adminUsers(
  _admin: Admin,
  db: BrainDb,
  opts: { search?: string; page?: number },
) {
  const page = Math.min(Math.max(1, Math.trunc(opts.page ?? 1) || 1), 10_000);
  const { rows, total } = await adminRepo.listUsers(db, {
    search: opts.search,
    offset: (page - 1) * ADMIN_PAGE,
  });
  return {
    page,
    pages: Math.max(1, Math.ceil(total / ADMIN_PAGE)),
    total,
    rows: rows.map((r) => ({
      ...r,
      name: safeDisplay(r.name, 100),
      email: safeDisplay(r.email, 200),
      createdAt: r.createdAt.toISOString(),
      suspendedAt: r.suspendedAt?.toISOString() ?? null,
      lastActivity: r.lastActivity?.toISOString() ?? null,
    })),
  };
}

export async function adminUser(_admin: Admin, db: BrainDb, userId: string) {
  if (!/^[\w-]{1,100}$/.test(userId)) throw new AppError(404, "not_found");
  const d = await adminRepo.userDetail(db, userId);
  if (!d) throw new AppError(404, "not_found");
  return {
    user: {
      ...d.user,
      name: safeDisplay(d.user.name, 100),
      email: safeDisplay(d.user.email, 200),
      createdAt: d.user.createdAt.toISOString(),
      suspendedAt: d.user.suspendedAt?.toISOString() ?? null,
    },
    projects: d.projects.map((p) => ({
      id: p.id,
      name: safeDisplay(p.name, 100),
      repo: p.repoFullName === null ? null : safeDisplay(p.repoFullName, 200),
      createdAt: p.createdAt.toISOString(),
      suspendedAt: p.suspendedAt?.toISOString() ?? null,
      receipts: p.receipts,
      lastReceiptAt: p.lastReceiptAt ? new Date(p.lastReceiptAt).toISOString() : null,
    })),
  };
}

/** AI calls and estimated cost per day and per project against the daily budget, and the projects that hit it. */
export async function adminAiUsage(_admin: Admin, db: BrainDb, now = new Date()) {
  const { range, rows } = await adminRepo.aiUsage(db, now, 30);
  const budget = dailyAiBudget();
  const cost = costPerCall();
  const perDay = range.map((day) => {
    const calls = rows.filter((r) => r.day === day).reduce((n, r) => n + r.calls, 0);
    return { day, calls, cost: calls * cost };
  });
  const byProject = new Map<
    string,
    { projectId: string; name: string; calls: number; daysAtBudget: number; peak: number }
  >();
  for (const r of rows) {
    const p = byProject.get(r.projectId) ?? {
      projectId: r.projectId,
      name: safeDisplay(r.projectName, 100),
      calls: 0,
      daysAtBudget: 0,
      peak: 0,
    };
    p.calls += r.calls;
    p.peak = Math.max(p.peak, r.calls);
    if (r.calls >= budget) p.daysAtBudget++;
    byProject.set(r.projectId, p);
  }
  const projects = [...byProject.values()]
    .map((p) => ({ ...p, cost: p.calls * cost }))
    .sort((a, b) => b.calls - a.calls);
  return {
    budget,
    costPerCall: cost,
    perDay,
    total: {
      calls: perDay.reduce((n, d) => n + d.calls, 0),
      cost: perDay.reduce((n, d) => n + d.cost, 0),
    },
    projects,
    atBudget: projects.filter((p) => p.daysAtBudget > 0),
  };
}

const MAX_CSV_ROWS = 50_000;

/** The waitlist as CSV (email, joined). Recorded in the audit log. Cells that a spreadsheet would run are quoted. */
export async function waitlistCsv(admin: Admin, db: BrainDb, now = new Date()) {
  await rateLimit(db, `admin:csv:${admin.user.id}`, 10, now);
  const lines = ["email,joined"];
  for (let offset = 0; offset < MAX_CSV_ROWS; offset += 50) {
    const page = await waitlistRepo.list(db, { offset });
    for (const r of page.items)
      lines.push(`${csvCell(r.email)},${r.createdAt.toISOString().slice(0, 10)}`);
    if (page.nextOffset === null) break;
  }
  await adminAuditRepo.record(db, {
    adminUserId: admin.user.id,
    adminLogin: admin.login,
    action: "export_waitlist",
    targetType: "waitlist",
    targetId: "all",
    detail: `${lines.length - 1} rows`,
  });
  return `${lines.join("\r\n")}\r\n`;
}

/** One CSV cell: quoted, inner quotes doubled, and a leading = + - @ (a formula) defused with a quote mark. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

const suspendSchema = z
  .object({
    targetType: z.enum(["user", "project"]),
    targetId: z.string().regex(/^[\w-]{1,100}$/),
    suspended: z.boolean(),
  })
  .strict();

/** Suspends or restores a user or project, and records it in the audit log. An admin cannot suspend themself. */
export async function setSuspended(admin: Admin, db: BrainDb, raw: unknown, now = new Date()) {
  await rateLimit(db, `admin:suspend:${admin.user.id}`, 60, now);
  const parsed = suspendSchema.safeParse(raw);
  if (!parsed.success)
    throw new AppError(400, "invalid_input", "send { targetType, targetId, suspended }");
  const { targetType, targetId, suspended } = parsed.data;
  if (targetType === "user" && targetId === admin.user.id) {
    throw new AppError(400, "cannot_suspend_self", "An admin cannot suspend their own account.");
  }
  const changed =
    targetType === "user"
      ? await adminRepo.setUserSuspended(db, targetId, suspended)
      : await adminRepo.setProjectSuspended(db, targetId, suspended);
  if (!changed) throw new AppError(404, "not_found");
  await adminAuditRepo.record(db, {
    adminUserId: admin.user.id,
    adminLogin: admin.login,
    action: suspended ? `suspend_${targetType}` : `unsuspend_${targetType}`,
    targetType,
    targetId,
  });
  return { targetType, targetId, suspended };
}

export async function auditLog(_admin: Admin, db: BrainDb) {
  const rows = await adminAuditRepo.list(db);
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    admin: safeDisplay(r.adminLogin, 60),
    action: safeDisplay(r.action, 60),
    target: `${safeDisplay(r.targetType, 30)} ${safeDisplay(r.targetId, 100)}`,
    detail: r.detail === null ? null : safeDisplay(r.detail, 200),
  }));
}
