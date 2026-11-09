import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type BlueprintVersionReason,
  type Boundary,
  type Criterion,
  blueprintVersions,
  blueprints,
  boundaries,
  checklistItems,
  criteria,
  criterionTests,
  featureAreas,
  featureDependencies,
  features,
  files,
} from "../schema";

// Roadmap Phase 3a: Project Blueprint repositories. Every query is scoped by project id; same-project composite
// foreign keys (0054) refuse any row that points into another project.

export class BlueprintConflictError extends Error {
  constructor(readonly current: number) {
    super("blueprint_changed");
  }
}

type Tx = Parameters<Parameters<BrainDb["transaction"]>[0]>[0];
export type BlueprintTx = Tx | BrainDb;

export type LiveBlueprint = {
  features: {
    id: string;
    key: string | null;
    name: string;
    description: string | null;
    buildOrder: number | null;
    status: string;
  }[];
  dependencies: { featureId: string; dependsOnId: string }[];
  areas: { featureId: string; pattern: string }[];
  criteria: Criterion[];
  tests: { criterionId: string; fileId: string; path: string; testName: string | null }[];
  boundaries: Boundary[];
};

const MAX_FEATURES = 500;

export const blueprintRepo = {
  /** The live Blueprint rows: features, their dependencies and areas, criteria (not retired) and boundaries. */
  async live(db: BlueprintTx, projectId: string): Promise<LiveBlueprint> {
    const [featureRows, dependencies, areas, criterionRows, tests, boundaryRows] =
      await Promise.all([
        db
          .select({
            id: features.id,
            key: features.key,
            name: features.name,
            description: features.description,
            buildOrder: features.buildOrder,
            status: features.status,
          })
          .from(features)
          .where(eq(features.projectId, projectId))
          .orderBy(asc(features.buildOrder), asc(features.name))
          .limit(MAX_FEATURES),
        db
          .select({
            featureId: featureDependencies.featureId,
            dependsOnId: featureDependencies.dependsOnId,
          })
          .from(featureDependencies)
          .where(eq(featureDependencies.projectId, projectId)),
        db
          .select({ featureId: featureAreas.featureId, pattern: featureAreas.pattern })
          .from(featureAreas)
          .where(eq(featureAreas.projectId, projectId)),
        db
          .select()
          .from(criteria)
          .where(
            and(
              eq(criteria.projectId, projectId),
              inArray(criteria.status, ["proposal", "active"]),
            ),
          )
          .orderBy(asc(criteria.position), asc(criteria.createdAt)),
        db
          .select({
            criterionId: criterionTests.criterionId,
            fileId: criterionTests.fileId,
            path: files.path,
            testName: criterionTests.testName,
          })
          .from(criterionTests)
          .innerJoin(
            files,
            and(eq(files.id, criterionTests.fileId), eq(files.projectId, criterionTests.projectId)),
          )
          .where(eq(criterionTests.projectId, projectId)),
        db
          .select()
          .from(boundaries)
          .where(
            and(
              eq(boundaries.projectId, projectId),
              inArray(boundaries.status, ["proposal", "active"]),
            ),
          )
          .orderBy(asc(boundaries.createdAt)),
      ]);
    return {
      features: featureRows,
      dependencies,
      areas,
      criteria: criterionRows,
      tests,
      boundaries: boundaryRows,
    };
  },

  async currentVersion(db: BlueprintTx, projectId: string): Promise<number> {
    const [row] = await db
      .select({ v: blueprints.currentVersion })
      .from(blueprints)
      .where(eq(blueprints.projectId, projectId));
    return row?.v ?? 0;
  },

  async listVersions(db: BrainDb, projectId: string, limit = 50) {
    return db
      .select({
        version: blueprintVersions.version,
        reason: blueprintVersions.reason,
        restoredFrom: blueprintVersions.restoredFrom,
        createdBy: blueprintVersions.createdBy,
        createdAt: blueprintVersions.createdAt,
      })
      .from(blueprintVersions)
      .where(eq(blueprintVersions.projectId, projectId))
      .orderBy(desc(blueprintVersions.version))
      .limit(Math.min(Math.max(limit, 1), 200));
  },

  async getVersion(db: BlueprintTx, projectId: string, version: number) {
    const [row] = await db
      .select()
      .from(blueprintVersions)
      .where(
        and(eq(blueprintVersions.projectId, projectId), eq(blueprintVersions.version, version)),
      );
    return row ?? null;
  },

  /**
   * One owner change as one transaction under the project's feature lock: refuses a stale base version (someone else
   * saved first), applies the change, builds the snapshot from the rows as they now are, and writes the next version.
   */
  // db may be a transaction (plan approval commits its version inside its own): drizzle nests it as a savepoint, and
  // the advisory lock is re-entrant for the same connection.
  async commit(
    db: BlueprintTx,
    projectId: string,
    opts: {
      userId: string | null;
      baseVersion: number;
      reason: BlueprintVersionReason;
      restoredFrom?: number;
      apply: (tx: Tx) => Promise<void>;
      snapshot: (live: LiveBlueprint, version: number) => { snapshot: unknown; hash: string };
    },
  ): Promise<number> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`features:${projectId}`}, 0))`,
      );
      const current = await blueprintRepo.currentVersion(tx, projectId);
      if (current !== opts.baseVersion) throw new BlueprintConflictError(current);
      await opts.apply(tx);
      const next = current + 1;
      const { snapshot, hash } = opts.snapshot(await blueprintRepo.live(tx, projectId), next);
      await tx.insert(blueprintVersions).values({
        projectId,
        version: next,
        snapshot,
        snapshotHash: hash,
        reason: opts.reason,
        restoredFrom: opts.restoredFrom ?? null,
        createdBy: opts.userId,
      });
      await tx
        .insert(blueprints)
        .values({ projectId, currentVersion: next, updatedBy: opts.userId, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: blueprints.projectId,
          set: { currentVersion: next, updatedBy: opts.userId, updatedAt: new Date() },
        });
      return next;
    });
  },

  /**
   * Runs fn in a transaction holding the project's proposal lock, so a count-then-insert (the open-proposal cap)
   * cannot be passed by parallel calls.
   */
  async withProposalLock<T>(
    db: BrainDb,
    projectId: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`blueprint-proposals:${projectId}`}, 0))`,
      );
      return fn(tx);
    });
  },

  async setPurpose(db: BlueprintTx, projectId: string, featureId: string, purpose: string | null) {
    await db
      .update(features)
      .set({ description: purpose })
      .where(and(eq(features.projectId, projectId), eq(features.id, featureId)));
  },

  async setBuildOrder(
    db: BlueprintTx,
    projectId: string,
    featureId: string,
    buildOrder: number | null,
  ) {
    await db
      .update(features)
      .set({ buildOrder })
      .where(and(eq(features.projectId, projectId), eq(features.id, featureId)));
  },

  async setDependencies(
    db: BlueprintTx,
    projectId: string,
    featureId: string,
    dependsOn: string[],
  ) {
    await db
      .delete(featureDependencies)
      .where(
        and(
          eq(featureDependencies.projectId, projectId),
          eq(featureDependencies.featureId, featureId),
        ),
      );
    if (dependsOn.length > 0) {
      await db
        .insert(featureDependencies)
        .values(dependsOn.map((dependsOnId) => ({ projectId, featureId, dependsOnId })));
    }
  },

  async setAreas(db: BlueprintTx, projectId: string, featureId: string, patterns: string[]) {
    await db
      .delete(featureAreas)
      .where(and(eq(featureAreas.projectId, projectId), eq(featureAreas.featureId, featureId)));
    if (patterns.length > 0) {
      await db
        .insert(featureAreas)
        .values(patterns.map((pattern) => ({ projectId, featureId, pattern })));
    }
  },
};

export const criteriaRepo = {
  async get(db: BlueprintTx, projectId: string, id: string): Promise<Criterion | null> {
    const [row] = await db
      .select()
      .from(criteria)
      .where(and(eq(criteria.projectId, projectId), eq(criteria.id, id)));
    return row ?? null;
  },

  async insert(
    db: BlueprintTx,
    projectId: string,
    data: Pick<Criterion, "featureId" | "text" | "kind" | "createdBy" | "status"> &
      Partial<Pick<Criterion, "ears" | "checklistItemId" | "position" | "id">>,
  ): Promise<Criterion> {
    const now = new Date();
    const [row] = await db
      .insert(criteria)
      .values({
        ...data,
        projectId,
        confirmedAt: data.status === "active" ? now : null,
        proposedAt: data.status === "proposal" ? now : null,
      })
      .returning();
    if (!row) throw new Error("insert criteria returned no row");
    return row;
  },

  async update(
    db: BlueprintTx,
    projectId: string,
    id: string,
    data: Partial<
      Pick<Criterion, "text" | "ears" | "kind" | "status" | "proposedChange" | "proposedAt">
    >,
  ) {
    const set: Record<string, unknown> = { ...data };
    if (data.status === "active") set.confirmedAt = new Date();
    await db
      .update(criteria)
      .set(set)
      .where(and(eq(criteria.projectId, projectId), eq(criteria.id, id)));
  },

  /** Phase 3b: the status of each criterion's checklist item (from receipts and the owner), for proof status. */
  async itemStatuses(db: BlueprintTx, projectId: string): Promise<Map<string, string>> {
    const rows = await db
      .select({ id: criteria.id, status: checklistItems.status })
      .from(criteria)
      .innerJoin(
        checklistItems,
        and(
          eq(checklistItems.projectId, criteria.projectId),
          eq(checklistItems.id, criteria.checklistItemId),
        ),
      )
      .where(eq(criteria.projectId, projectId));
    return new Map(rows.map((r) => [r.id, r.status]));
  },

  async countOpenProposals(db: BlueprintTx, projectId: string): Promise<number> {
    const [c] = await db
      .select({ n: count() })
      .from(criteria)
      .where(
        and(
          eq(criteria.projectId, projectId),
          sql`(${criteria.status} = 'proposal' OR ${criteria.proposedChange} IS NOT NULL)`,
        ),
      );
    return Number(c?.n ?? 0);
  },

  async linkTest(
    db: BlueprintTx,
    projectId: string,
    criterionId: string,
    fileId: string,
    testName: string | null,
  ) {
    await db
      .insert(criterionTests)
      .values({ projectId, criterionId, fileId, testName })
      .onConflictDoNothing();
  },

  async clearTests(db: BlueprintTx, projectId: string, criterionId: string) {
    await db
      .delete(criterionTests)
      .where(
        and(eq(criterionTests.projectId, projectId), eq(criterionTests.criterionId, criterionId)),
      );
  },

  /** Roadmap Phase 4b: the test files (and names) linked to a feature's active criteria, for its context pack. */
  async testsForFeature(db: BlueprintTx, projectId: string, featureId: string, limit = 20) {
    return db
      .selectDistinct({ path: files.path, testName: criterionTests.testName })
      .from(criterionTests)
      .innerJoin(
        criteria,
        and(
          eq(criteria.projectId, criterionTests.projectId),
          eq(criteria.id, criterionTests.criterionId),
        ),
      )
      .innerJoin(
        files,
        and(eq(files.projectId, criterionTests.projectId), eq(files.id, criterionTests.fileId)),
      )
      .where(
        and(
          eq(criterionTests.projectId, projectId),
          eq(criteria.featureId, featureId),
          eq(criteria.status, "active"),
        ),
      )
      .orderBy(asc(files.path))
      .limit(limit);
  },

  /** Roadmap Phase 4b: a feature's active must-never and security criteria only (the start note shows up to 3). */
  async guardsForFeature(db: BlueprintTx, projectId: string, featureId: string, limit = 3) {
    return db
      .select({ id: criteria.id, text: criteria.text, kind: criteria.kind })
      .from(criteria)
      .where(
        and(
          eq(criteria.projectId, projectId),
          eq(criteria.featureId, featureId),
          eq(criteria.status, "active"),
          inArray(criteria.kind, ["must_never", "security"]),
        ),
      )
      .orderBy(asc(criteria.position), asc(criteria.createdAt))
      .limit(limit);
  },

  /** A feature's active criteria (the context pack shows them). */
  async activeForFeature(db: BlueprintTx, projectId: string, featureId: string, limit = 30) {
    return db
      .select({ id: criteria.id, text: criteria.text, kind: criteria.kind })
      .from(criteria)
      .where(
        and(
          eq(criteria.projectId, projectId),
          eq(criteria.featureId, featureId),
          eq(criteria.status, "active"),
        ),
      )
      .orderBy(asc(criteria.position), asc(criteria.createdAt))
      .limit(limit);
  },

  /** Every criterion of the project (any status), for restore. */
  async all(db: BlueprintTx, projectId: string): Promise<Criterion[]> {
    return db.select().from(criteria).where(eq(criteria.projectId, projectId));
  },
};

export const boundariesRepo = {
  async insert(
    db: BlueprintTx,
    projectId: string,
    data: Pick<Boundary, "kind" | "pattern" | "note" | "createdBy" | "status"> &
      Partial<Pick<Boundary, "id">>,
  ): Promise<Boundary> {
    const [row] = await db
      .insert(boundaries)
      .values({ ...data, projectId, confirmedAt: data.status === "active" ? new Date() : null })
      .returning();
    if (!row) throw new Error("insert boundaries returned no row");
    return row;
  },

  async setStatus(db: BlueprintTx, projectId: string, id: string, status: Boundary["status"]) {
    await db
      .update(boundaries)
      .set({ status, ...(status === "active" ? { confirmedAt: new Date() } : {}) })
      .where(and(eq(boundaries.projectId, projectId), eq(boundaries.id, id)));
  },

  async get(db: BlueprintTx, projectId: string, id: string): Promise<Boundary | null> {
    const [row] = await db
      .select()
      .from(boundaries)
      .where(and(eq(boundaries.projectId, projectId), eq(boundaries.id, id)));
    return row ?? null;
  },

  async all(db: BlueprintTx, projectId: string): Promise<Boundary[]> {
    return db.select().from(boundaries).where(eq(boundaries.projectId, projectId));
  },

  async active(db: BlueprintTx, projectId: string, limit = 50) {
    return db
      .select({ kind: boundaries.kind, pattern: boundaries.pattern })
      .from(boundaries)
      .where(and(eq(boundaries.projectId, projectId), eq(boundaries.status, "active")))
      .orderBy(asc(boundaries.createdAt))
      .limit(limit);
  },

  async countOpenProposals(db: BlueprintTx, projectId: string): Promise<number> {
    const [c] = await db
      .select({ n: count() })
      .from(boundaries)
      .where(and(eq(boundaries.projectId, projectId), eq(boundaries.status, "proposal")));
    return Number(c?.n ?? 0);
  },
};
