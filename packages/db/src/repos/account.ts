import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  checklistItems,
  decisions,
  features,
  projectTokens,
  projects,
  receipts,
  requests,
  sessions,
  users,
  waitlist,
} from "../schema";

// The account page (2026-11-01): connected computers, signing out everywhere, the data export and deleting an
// account. Everything is scoped by the owner's user id; nothing here ever returns a token value or a hash.

export const MAX_CONNECTED = 200;
// Data export caps (build checklist rule 4): per project, newest first; the export says when it was cut.
export const EXPORT_LIMITS = {
  projects: 100,
  features: 1000,
  requests: 2000,
  checklistItems: 5000,
  receipts: 2000,
  decisions: 1000,
} as const;

export type ConnectedComputer = {
  id: string;
  projectId: string;
  projectName: string;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export const accountRepo = {
  /** Every CLI token on the user's own projects, newest first (never the hash). */
  async connectedComputers(db: BrainDb, userId: string): Promise<ConnectedComputer[]> {
    return db
      .select({
        id: projectTokens.id,
        projectId: projectTokens.projectId,
        projectName: projects.name,
        label: projectTokens.label,
        createdAt: projectTokens.createdAt,
        lastUsedAt: projectTokens.lastUsedAt,
        revokedAt: projectTokens.revokedAt,
      })
      .from(projectTokens)
      .innerJoin(projects, eq(projects.id, projectTokens.projectId))
      .where(eq(projects.ownerId, userId))
      .orderBy(desc(projectTokens.createdAt), desc(projectTokens.id))
      .limit(MAX_CONNECTED);
  },

  /** Ends every sign-in session of the user (all browsers); returns how many there were. */
  async endAllSessions(db: BrainDb, userId: string): Promise<number> {
    const rows = await db
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .returning({ id: sessions.id });
    return rows.length;
  },

  /**
   * Everything the user owns, as plain data: projects with their features, requests, checklist items, receipts and
   * decisions. Never tokens, hashes, sign-in accounts or sessions.
   */
  async exportData(db: BrainDb, userId: string) {
    const [user] = await db
      .select({ name: users.name, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const owned = await db
      .select({
        id: projects.id,
        name: projects.name,
        repoFullName: projects.repoFullName,
        createdAt: projects.createdAt,
      })
      .from(projects)
      .where(eq(projects.ownerId, userId))
      .orderBy(asc(projects.createdAt), asc(projects.id))
      .limit(EXPORT_LIMITS.projects + 1);
    const truncated = owned.length > EXPORT_LIMITS.projects;
    const list = owned.slice(0, EXPORT_LIMITS.projects);
    const out = [];
    for (const p of list) {
      const [f, r, c, rc, d] = await Promise.all([
        db
          .select({
            id: features.id,
            name: features.name,
            description: features.description,
            status: features.status,
            createdAt: features.createdAt,
          })
          .from(features)
          .where(eq(features.projectId, p.id))
          .orderBy(asc(features.createdAt))
          .limit(EXPORT_LIMITS.features),
        db
          .select({
            id: requests.id,
            featureId: requests.featureId,
            text: requests.text,
            createdAt: requests.createdAt,
          })
          .from(requests)
          .where(eq(requests.projectId, p.id))
          .orderBy(desc(requests.createdAt))
          .limit(EXPORT_LIMITS.requests),
        db
          .select({
            id: checklistItems.id,
            requestId: checklistItems.requestId,
            text: checklistItems.text,
            status: checklistItems.status,
          })
          .from(checklistItems)
          .where(eq(checklistItems.projectId, p.id))
          .orderBy(asc(checklistItems.requestId), asc(checklistItems.position))
          .limit(EXPORT_LIMITS.checklistItems),
        db
          .select({
            id: receipts.id,
            requestId: receipts.requestId,
            commitSha: receipts.commitSha,
            summary: receipts.summaryJson,
            createdAt: receipts.createdAt,
          })
          .from(receipts)
          .where(eq(receipts.projectId, p.id))
          .orderBy(desc(receipts.createdAt))
          .limit(EXPORT_LIMITS.receipts),
        db
          .select({
            id: decisions.id,
            title: decisions.title,
            reason: decisions.reason,
            createdAt: decisions.createdAt,
          })
          .from(decisions)
          .where(eq(decisions.projectId, p.id))
          .orderBy(desc(decisions.createdAt))
          .limit(EXPORT_LIMITS.decisions),
      ]);
      out.push({
        ...p,
        features: f,
        requests: r,
        checklistItems: c,
        receipts: rc,
        decisions: d,
      });
    }
    return { user: user ?? null, projects: out, truncated };
  },

  /**
   * Deletes the account for good: the user row (its projects, tokens, sessions, sign-in accounts, device codes and
   * every project's data go with it through ON DELETE CASCADE) and the waitlist entry for the same email.
   */
  async deleteAccount(db: BrainDb, userId: string): Promise<{ deleted: boolean }> {
    return db.transaction(async (tx) => {
      const [u] = await tx
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!u) return { deleted: false };
      await tx.delete(waitlist).where(eq(waitlist.email, u.email.trim().toLowerCase()));
      const gone = await tx.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
      return { deleted: gone.length > 0 };
    });
  },

  /** Whether the user or any of the given projects is suspended (the shell and the API refuse them). */
  async suspension(
    db: BrainDb,
    userId: string,
    projectIds: string[] = [],
  ): Promise<{ user: boolean; projects: string[] }> {
    const [u] = await db
      .select({ s: users.suspendedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const ps =
      projectIds.length === 0
        ? []
        : await db
            .select({ id: projects.id, s: projects.suspendedAt })
            .from(projects)
            .where(
              and(inArray(projects.id, projectIds.slice(0, 100)), eq(projects.ownerId, userId)),
            );
    return { user: Boolean(u?.s), projects: ps.filter((p) => p.s).map((p) => p.id) };
  },
};
