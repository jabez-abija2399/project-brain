// Roadmap Phase 6a: approval policies on the server. The owner (a signed-in session that owns the project) reads and
// changes the policy and decides requests; an agent (a project token) can only ask, and gets the policy's answer:
// refused, asked (the owner decides later; it expires after 24 hours), or approved automatically. Agents can never
// approve, change or bypass a policy. Every change and decision is written to the append-only audit log. Before
// migration 0055 every path answers "not set up yet".
import {
  type ApprovalAction,
  type ApprovalRule,
  DEFAULT_POLICY,
  type Policy,
  REQUEST_TTL_MS,
  decide,
  isApprovalAction,
  loosens,
  maskPath,
  maskSecretsIn,
  parsePolicy,
  plainText,
} from "@brain/core";
import {
  type BrainDb,
  approvalAuditRepo,
  approvalPoliciesRepo,
  approvalRequestsRepo,
} from "@brain/db";
import { type SessionUser, requireProjectAccess } from "./auth";
import { AppError } from "./errors";
import { missingMigrations } from "./migration-check";

export const APPROVALS_MIGRATION = "0055_approvals";
const MAX_PENDING = 200;
const NOT_READY = { ready: false as const };

export async function approvalsEnabled(db: BrainDb): Promise<boolean> {
  return !(await missingMigrations(db)).includes(APPROVALS_MIGRATION);
}

async function requireReady(db: BrainDb) {
  if (!(await approvalsEnabled(db))) {
    throw new AppError(503, "approvals_not_ready", "Approvals are being set up for this server.");
  }
}

async function currentPolicy(db: BrainDb, projectId: string): Promise<Policy> {
  const row = await approvalPoliciesRepo.get(db, projectId);
  if (!row) return DEFAULT_POLICY;
  return (
    parsePolicy({
      preset: row.preset,
      rules: row.rules,
      pausedUntil: row.pausedUntil?.toISOString() ?? null,
    }) ?? DEFAULT_POLICY
  );
}

const view = (r: Awaited<ReturnType<typeof approvalRequestsRepo.list>>[number]) => ({
  id: r.id,
  action: r.action,
  risk: r.risk,
  feature: r.feature,
  path: r.path,
  agent: r.agent,
  summary: r.summary,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  expiresAt: r.expiresAt.toISOString(),
  undone: r.undoneAt !== null,
});

/** Owner: the policy, the pending requests and the latest automatic approvals (for the daily summary and undo). */
export async function approvalsOverview(db: BrainDb, user: SessionUser, projectId: string) {
  // Every owner function checks access itself too, not only its route (a stranger gets 404).
  await requireProjectAccess(db, projectId, user);
  if (!(await approvalsEnabled(db))) return NOT_READY;
  await approvalRequestsRepo.expire(db, projectId, new Date());
  const [policy, pending, auto] = await Promise.all([
    currentPolicy(db, projectId),
    approvalRequestsRepo.list(db, projectId, "pending", 100),
    approvalRequestsRepo.list(db, projectId, "auto", 50),
  ]);
  return { ready: true as const, policy, pending: pending.map(view), automatic: auto.map(view) };
}

/** Owner: a new policy. Loosening it needs `confirm: true`; tightening is instant. Refused whole when not valid. */
export async function setPolicy(db: BrainDb, user: SessionUser, projectId: string, body: unknown) {
  await requireProjectAccess(db, projectId, user);
  await requireReady(db);
  const b = (body ?? {}) as { policy?: unknown; confirm?: unknown };
  const next = parsePolicy(b.policy);
  if (!next)
    throw new AppError(400, "invalid_policy", "The policy is not valid; nothing was changed.");
  const before = await currentPolicy(db, projectId);
  const looser = loosens(before, next);
  if (looser && b.confirm !== true) {
    throw new AppError(
      409,
      "confirm_loosening",
      "This allows more than before: confirm the change.",
    );
  }
  await approvalPoliciesRepo.upsert(db, projectId, {
    preset: next.preset,
    rules: next.rules,
    pausedUntil: next.pausedUntil ? new Date(next.pausedUntil) : null,
    updatedBy: user.id,
  });
  await approvalAuditRepo.append(db, projectId, {
    event: "policy_changed",
    actorKind: "owner",
    actorId: user.id,
    detail: { preset: next.preset, rules: next.rules.length, loosened: looser },
  });
  return { ok: true, policy: next };
}

/** Owner: pause automatic approvals for 1, 2 or 4 hours (everything is asked meanwhile), or end the pause. */
export async function pauseApprovals(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  body: unknown,
) {
  await requireProjectAccess(db, projectId, user);
  await requireReady(db);
  const hours = (body as { hours?: unknown } | null)?.hours;
  if (hours !== null && hours !== 1 && hours !== 2 && hours !== 4) {
    throw new AppError(400, "invalid_input", "send { hours: 1 | 2 | 4 | null }");
  }
  const policy = await currentPolicy(db, projectId);
  const pausedUntil = hours === null ? null : new Date(Date.now() + hours * 3_600_000);
  await approvalPoliciesRepo.upsert(db, projectId, {
    preset: policy.preset,
    rules: policy.rules,
    pausedUntil,
    updatedBy: user.id,
  });
  await approvalAuditRepo.append(db, projectId, {
    event: hours === null ? "pause_ended" : "paused",
    actorKind: "owner",
    actorId: user.id,
    detail: { hours },
  });
  return { ok: true, pausedUntil: pausedUntil?.toISOString() ?? null };
}

/**
 * Owner: approve or reject a pending request. `remember: true` also adds a rule for the same kind of request (an
 * always-approve rule cannot make a locked action automatic: the engine keeps asking for those).
 */
export async function decideRequest(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  body: unknown,
) {
  await requireProjectAccess(db, projectId, user);
  await requireReady(db);
  const b = (body ?? {}) as { requestId?: unknown; decision?: unknown; remember?: unknown };
  if (typeof b.requestId !== "string" || (b.decision !== "approve" && b.decision !== "reject")) {
    throw new AppError(400, "invalid_input", 'send { requestId, decision: "approve" | "reject" }');
  }
  const row = await approvalRequestsRepo.decide(
    db,
    projectId,
    b.requestId,
    b.decision === "approve" ? "approved" : "rejected",
    user.id,
    new Date(),
  );
  if (!row)
    throw new AppError(409, "not_pending", "This request was already decided or has expired.");
  if (b.remember === true && isApprovalAction(row.action)) {
    const policy = await currentPolicy(db, projectId);
    const rule: ApprovalRule = {
      action: row.action,
      ...(row.feature ? { feature: row.feature } : {}),
      ...(row.agent ? { agent: row.agent } : {}),
      choice: b.decision === "approve" ? "auto" : "never",
    };
    await approvalPoliciesRepo.upsert(db, projectId, {
      preset: policy.preset,
      rules: [...policy.rules, rule].slice(-100),
      pausedUntil: policy.pausedUntil ? new Date(policy.pausedUntil) : null,
      updatedBy: user.id,
    });
  }
  await approvalAuditRepo.append(db, projectId, {
    event: b.decision === "approve" ? "approved" : "rejected",
    requestId: row.id,
    actorKind: "owner",
    actorId: user.id,
    detail: { action: row.action, remembered: b.remember === true },
  });
  return { ok: true, request: view(row) };
}

/** Owner: undo an automatic approval (recorded once; the action it allowed is reverted by its own feature). */
export async function undoAutomatic(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  body: unknown,
) {
  await requireProjectAccess(db, projectId, user);
  await requireReady(db);
  const requestId = (body as { requestId?: unknown } | null)?.requestId;
  if (typeof requestId !== "string") throw new AppError(400, "invalid_input", "send { requestId }");
  const row = await approvalRequestsRepo.undo(db, projectId, requestId, new Date());
  if (!row)
    throw new AppError(409, "not_undoable", "Only an automatic approval can be undone, once.");
  await approvalAuditRepo.append(db, projectId, {
    event: "undone",
    requestId: row.id,
    actorKind: "owner",
    actorId: user.id,
    detail: { action: row.action },
  });
  return { ok: true, request: view(row) };
}

const clean = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() !== "" ? maskSecretsIn(plainText(v)).slice(0, max) : null;

/**
 * Agent (project token): asks for an action. The answer is the policy's: "never" (refused), "ask" (pending until the
 * owner decides or it expires), or "auto" / "auto_tell" (approved now). An agent can never decide a request.
 */
export async function agentAsk(db: BrainDb, projectId: string, body: unknown) {
  if (!(await approvalsEnabled(db))) return NOT_READY;
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isApprovalAction(b.action)) throw new AppError(400, "invalid_action", "Unknown action.");
  const summary = clean(b.summary, 300);
  if (!summary)
    throw new AppError(400, "invalid_input", "send { action, summary } (summary: what and why)");
  const feature = clean(b.feature, 200);
  const path =
    typeof b.path === "string" && b.path ? maskPath(plainText(b.path)).slice(0, 1024) : null;
  const agent =
    typeof b.agent === "string" && /^[a-z][a-z0-9-]{0,39}$/.test(b.agent) ? b.agent : null;
  const now = new Date();
  await approvalRequestsRepo.expire(db, projectId, now);
  const pending = await approvalRequestsRepo.list(db, projectId, "pending", MAX_PENDING);
  if (pending.length >= MAX_PENDING) {
    throw new AppError(
      429,
      "too_many_pending",
      "The owner has too many open requests; try again later.",
    );
  }
  const policy = await currentPolicy(db, projectId);
  const { choice, risk, reason } = decide(
    policy,
    { action: b.action as ApprovalAction, feature, path, agent },
    now,
  );
  const status = choice === "never" ? "never" : choice === "ask" ? "pending" : "auto";
  const row = await approvalRequestsRepo.insert(db, projectId, {
    action: b.action as string,
    risk,
    feature,
    path,
    agent,
    summary,
    status,
    expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
  });
  await approvalAuditRepo.append(db, projectId, {
    event: `asked_${status}`,
    requestId: row.id,
    actorKind: "agent",
    detail: { action: row.action, choice },
  });
  return { ready: true as const, id: row.id, status, choice, reason, tell: choice === "auto_tell" };
}

/** Agent (project token): the current status of one of its project's requests. */
export async function agentStatus(db: BrainDb, projectId: string, requestId: string | null) {
  if (!(await approvalsEnabled(db))) return NOT_READY;
  if (!requestId) throw new AppError(400, "invalid_input", "send ?id=<request id>");
  await approvalRequestsRepo.expire(db, projectId, new Date());
  const row = await approvalRequestsRepo.get(db, projectId, requestId);
  if (!row) throw new AppError(404, "not_found");
  return { ready: true as const, id: row.id, status: row.status, undone: row.undoneAt !== null };
}
