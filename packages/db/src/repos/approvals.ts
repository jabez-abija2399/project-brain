import { and, desc, eq, gte, isNull, lt } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type ApprovalPolicyRow,
  type ApprovalRequestRow,
  approvalAudit,
  approvalPolicies,
  approvalRequests,
} from "../schema";

// Roadmap Phase 6a: approval policies, requests and the append-only audit log. Every read and write is scoped to the
// project; who may call which (owner or agent token) is decided by the server, never here.

export const approvalPoliciesRepo = {
  async get(db: BrainDb, projectId: string): Promise<ApprovalPolicyRow | null> {
    const [row] = await db
      .select()
      .from(approvalPolicies)
      .where(eq(approvalPolicies.projectId, projectId));
    return row ?? null;
  },

  async upsert(
    db: BrainDb,
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
    db: BrainDb,
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

  async get(db: BrainDb, projectId: string, id: string): Promise<ApprovalRequestRow | null> {
    const [row] = await db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.projectId, projectId), eq(approvalRequests.id, id)));
    return row ?? null;
  },

  async list(
    db: BrainDb,
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

  /** Decides a still-pending, unexpired request; null when it was not pending (already decided or expired). */
  async decide(
    db: BrainDb,
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
  async undo(db: BrainDb, projectId: string, id: string, now: Date) {
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

  /** Pending requests past their expiry become "expired" (nothing happens for them). */
  async expire(db: BrainDb, projectId: string, now: Date) {
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
    db: BrainDb,
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

  async list(db: BrainDb, projectId: string, limit = 200) {
    return db
      .select()
      .from(approvalAudit)
      .where(eq(approvalAudit.projectId, projectId))
      .orderBy(desc(approvalAudit.createdAt))
      .limit(limit);
  },
};
