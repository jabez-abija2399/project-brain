import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type GithubInstallState,
  githubInstallStates,
  projects,
  users,
  webhookDeliveries,
} from "../schema";
import { isUniqueViolation } from "./features";

// Delivery ids are kept this long; GitHub only redelivers recent deliveries.
const DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
// One repo push re-indexes at most this many linked projects.
const MAX_LINKED_PROJECTS = 10;

export class RepoAlreadyLinkedError extends Error {
  constructor() {
    super("this repository is already linked to another of your projects");
  }
}

export const githubRepo = {
  // Links the owner's project to one repo of an installation. Null when the project is not this owner's.
  async linkProject(
    db: BrainDb,
    projectId: string,
    ownerId: string,
    installationId: number,
    repoFullName: string,
  ): Promise<{ id: string } | null> {
    try {
      const [row] = await db
        .update(projects)
        .set({ installationId, repoFullName })
        .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
        .returning({ id: projects.id });
      return row ?? null;
    } catch (err) {
      if (isUniqueViolation(err)) throw new RepoAlreadyLinkedError();
      throw err;
    }
  },

  // Projects linked to this installation's repo (the signed webhook names both). Suspended projects, and projects of
  // suspended users, are left out (2026-11-01): a push to them makes no receipt and spends no AI budget.
  async linkedProjects(
    db: BrainDb,
    installationId: number,
    repoFullName: string,
  ): Promise<{ id: string }[]> {
    return db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.ownerId))
      .where(
        and(
          eq(projects.installationId, installationId),
          eq(projects.repoFullName, repoFullName),
          isNull(projects.suspendedAt),
          isNull(users.suspendedAt),
        ),
      )
      .orderBy(projects.id)
      .limit(MAX_LINKED_PROJECTS);
  },

  async isLinked(
    db: BrainDb,
    projectId: string,
    installationId: number,
    repoFullName: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.installationId, installationId),
          eq(projects.repoFullName, repoFullName),
        ),
      )
      .limit(1);
    return row !== undefined;
  },

  // The App was uninstalled: its projects stop receiving pushes.
  async unlinkInstallation(db: BrainDb, installationId: number): Promise<number> {
    const rows = await db
      .update(projects)
      .set({ installationId: null })
      .where(eq(projects.installationId, installationId))
      .returning({ id: projects.id });
    return rows.length;
  },

  // True the first time a delivery id is seen, false for a replay. Old ids are pruned on the way.
  async recordDelivery(db: BrainDb, deliveryId: string, now: Date): Promise<boolean> {
    await db
      .delete(webhookDeliveries)
      .where(lt(webhookDeliveries.receivedAt, new Date(now.getTime() - DELIVERY_RETENTION_MS)));
    const inserted = await db
      .insert(webhookDeliveries)
      .values({ deliveryId, receivedAt: now })
      .onConflictDoNothing()
      .returning({ deliveryId: webhookDeliveries.deliveryId });
    return inserted.length === 1;
  },

  // Enqueueing failed: let GitHub's redelivery of the same id be processed.
  async forgetDelivery(db: BrainDb, deliveryId: string): Promise<void> {
    await db.delete(webhookDeliveries).where(eq(webhookDeliveries.deliveryId, deliveryId));
  },

  async createState(
    db: BrainDb,
    data: { stateHash: string; userId: string; projectId: string; expiresAt: Date },
  ): Promise<void> {
    await db
      .delete(githubInstallStates)
      .where(lt(githubInstallStates.expiresAt, sql`now() - interval '1 day'`));
    await db.insert(githubInstallStates).values(data);
  },

  // The state if it is unused and not expired, else null.
  async liveState(db: BrainDb, stateHash: string, now: Date): Promise<GithubInstallState | null> {
    const [row] = await db
      .select()
      .from(githubInstallStates)
      .where(and(eq(githubInstallStates.stateHash, stateHash), isNull(githubInstallStates.usedAt)))
      .limit(1);
    if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
    return row;
  },

  async setStateInstallation(
    db: BrainDb,
    stateHash: string,
    installationId: number,
  ): Promise<void> {
    await db
      .update(githubInstallStates)
      .set({ installationId })
      .where(and(eq(githubInstallStates.stateHash, stateHash), isNull(githubInstallStates.usedAt)));
  },

  // Single use: true only for the one call that marks a live state used (atomic, so parallel calls cannot both pass).
  async useState(db: BrainDb, stateHash: string, now: Date): Promise<boolean> {
    const rows = await db
      .update(githubInstallStates)
      .set({ usedAt: now })
      .where(
        and(
          eq(githubInstallStates.stateHash, stateHash),
          isNull(githubInstallStates.usedAt),
          sql`${githubInstallStates.expiresAt} > ${now}`,
        ),
      )
      .returning({ stateHash: githubInstallStates.stateHash });
    return rows.length === 1;
  },
};
