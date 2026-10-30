import { and, asc, count, eq, inArray, isNotNull, ne, notExists, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type Feature, type NewFeature, featureFiles, features, files } from "../schema";

/** Another feature of the project already has this name (features_project_name_uniq). */
export class FeatureNameTakenError extends Error {
  constructor() {
    super("a feature with this name already exists in the project");
  }
}

class FileNotInProject extends Error {}

/** Features a project can hold before creating one by hand is refused (checklist rule 4). */
export const MAX_FEATURES_PER_PROJECT = 500;
const LINK_BATCH = 5000;

export function isUniqueViolation(err: unknown): boolean {
  // drizzle wraps the driver error; walk the cause chain for Postgres code 23505.
  for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === "23505") return true;
  }
  return false;
}

/** Stable path-derived feature keys (with display names) map to file paths; paths must already be stored in `files`. */
export type FeatureMapInput = {
  features: { key: string; name: string; files: string[] }[];
  shared: { path: string; usedBy: string[] }[];
};

export type FeatureUpdate = { name?: string; moveFileIds?: string[] };

export const featuresRepo = {
  async insert(
    db: BrainDb,
    projectId: string,
    data: Omit<NewFeature, "projectId">,
  ): Promise<Feature> {
    const [row] = await db
      .insert(features)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert features returned no row");
    return row;
  },

  // FEAT-019: the first feature of the approved plan, by build order, that is not done (where_did_we_stop names it).
  async nextByBuildOrder(db: BrainDb, projectId: string): Promise<Feature | null> {
    const [row] = await db
      .select()
      .from(features)
      .where(
        and(
          eq(features.projectId, projectId),
          isNotNull(features.buildOrder),
          ne(features.status, "done"),
        ),
      )
      .orderBy(asc(features.buildOrder), asc(features.createdAt), asc(features.id))
      .limit(1);
    return row ?? null;
  },

  // Features whose status is 'in_progress', by name (the handoff note lists them).
  async listInProgress(db: BrainDb, projectId: string, limit: number): Promise<Feature[]> {
    return db
      .select()
      .from(features)
      .where(and(eq(features.projectId, projectId), eq(features.status, "in_progress")))
      .orderBy(asc(features.name))
      .limit(limit);
  },

  /**
   * A feature the user creates by hand (key NULL, so a re-index never matches or renames it). Returns null when the
   * project already has MAX_FEATURES_PER_PROJECT features (counted under a per-project advisory lock, so parallel
   * requests cannot pass it). Throws FeatureNameTakenError on a duplicate name.
   */
  async create(db: BrainDb, projectId: string, name: string): Promise<Feature | null> {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`features:${projectId}`}, 0))`,
        );
        const [n] = await tx
          .select({ n: count() })
          .from(features)
          .where(eq(features.projectId, projectId));
        if ((n?.n ?? 0) >= MAX_FEATURES_PER_PROJECT) return null;
        const [row] = await tx.insert(features).values({ projectId, name }).returning();
        return row ?? null;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new FeatureNameTakenError();
      throw err;
    }
  },

  /**
   * The project's features by name with their primary file counts, at most `limit` of them, plus the total number
   * of features (so a caller can say the list was cut). Two bounded queries.
   */
  async listSummaries(
    db: BrainDb,
    projectId: string,
    limit: number,
  ): Promise<{
    features: { id: string; name: string; status: string; files: number }[];
    total: number;
  }> {
    const [rows, [n]] = await Promise.all([
      db
        .select({
          id: features.id,
          name: features.name,
          status: features.status,
          files: count(featureFiles.fileId),
        })
        .from(features)
        .leftJoin(
          featureFiles,
          and(
            eq(featureFiles.projectId, features.projectId),
            eq(featureFiles.featureId, features.id),
            eq(featureFiles.role, "primary"),
          ),
        )
        .where(eq(features.projectId, projectId))
        .groupBy(features.id, features.name, features.status)
        .orderBy(asc(features.name))
        .limit(limit),
      db.select({ n: count() }).from(features).where(eq(features.projectId, projectId)),
    ]);
    return { features: rows, total: n?.n ?? 0 };
  },

  async list(db: BrainDb, projectId: string): Promise<Feature[]> {
    return db.select().from(features).where(eq(features.projectId, projectId));
  },

  async byId(db: BrainDb, projectId: string, id: string): Promise<Feature | null> {
    const rows = await db
      .select()
      .from(features)
      .where(and(eq(features.projectId, projectId), eq(features.id, id)))
      .limit(1);
    return rows[0] ?? null;
  },

  async byKeys(db: BrainDb, projectId: string, keys: string[]): Promise<Feature[]> {
    if (keys.length === 0) return [];
    return db
      .select()
      .from(features)
      .where(and(eq(features.projectId, projectId), inArray(features.key, keys)));
  },

  async byName(db: BrainDb, projectId: string, name: string): Promise<Feature | null> {
    const rows = await db
      .select()
      .from(features)
      .where(and(eq(features.projectId, projectId), eq(features.name, name)))
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Renames the feature (its key stays) and/or moves files into it as their primary feature (a moved shared
   * file stops being shared; the move is user-placed, so a re-index keeps it), in one transaction. Returns null when the feature or any file is not in the project.
   * Throws FeatureNameTakenError on a duplicate name.
   */
  async update(
    db: BrainDb,
    projectId: string,
    featureId: string,
    change: FeatureUpdate,
  ): Promise<Feature | null> {
    try {
      return await db.transaction(async (tx) => {
        const [feature] = await tx
          .select()
          .from(features)
          .where(and(eq(features.projectId, projectId), eq(features.id, featureId)))
          .for("update");
        if (!feature) return null;
        const fileIds = [...new Set(change.moveFileIds ?? [])];
        if (fileIds.length > 0) {
          const found = await tx
            .select({ id: files.id })
            .from(files)
            .where(and(eq(files.projectId, projectId), inArray(files.id, fileIds)));
          if (found.length !== fileIds.length) throw new FileNotInProject();
          await tx
            .delete(featureFiles)
            .where(
              and(eq(featureFiles.projectId, projectId), inArray(featureFiles.fileId, fileIds)),
            );
          await tx.insert(featureFiles).values(
            fileIds.map((fileId) => ({
              projectId,
              featureId,
              fileId,
              role: "primary" as const,
              placedBy: "user" as const,
            })),
          );
        }
        if (change.name === undefined || change.name === feature.name) return feature;
        const [renamed] = await tx
          .update(features)
          .set({ name: change.name, nameSetByUser: true })
          .where(and(eq(features.projectId, projectId), eq(features.id, featureId)))
          .returning();
        return renamed ?? null;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new FeatureNameTakenError();
      if (err instanceof FileNotInProject) return null;
      throw err;
    }
  },

  /**
   * Stores a grouped feature map (a re-index calls it again): features found by key (renames survive), new ones named
   * from the map (`-2` when taken), automatic links replaced, user-placed links kept. Throws on a path not stored.
   */
  async saveMap(db: BrainDb, projectId: string, map: FeatureMapInput): Promise<void> {
    await db.transaction(async (tx) => {
      await saveLinks(tx, projectId, map);
      // KI-037: path-derived features the map left with no files go; ones the user created or renamed stay.
      await tx.delete(features).where(
        and(
          eq(features.projectId, projectId),
          isNotNull(features.key),
          eq(features.nameSetByUser, false),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(featureFiles)
              .where(
                and(eq(featureFiles.projectId, projectId), eq(featureFiles.featureId, features.id)),
              ),
          ),
        ),
      );
    });
  },
};

type Tx = Parameters<Parameters<BrainDb["transaction"]>[0]>[0];

// saveMap's features and links: features found by key (new ones created), automatic links replaced by the map's.
async function saveLinks(tx: Tx, projectId: string, map: FeatureMapInput): Promise<void> {
  const keys = new Set([...map.features.map((f) => f.key), ...map.shared.flatMap((s) => s.usedBy)]);
  const nameOf = new Map(map.features.map((f) => [f.key, f.name]));
  if (keys.size === 0) return;
  const existing = await tx
    .select({ id: features.id, key: features.key, name: features.name })
    .from(features)
    .where(eq(features.projectId, projectId));
  const featureId = new Map<string, string>();
  for (const f of existing) if (f.key !== null) featureId.set(f.key, f.id);
  const taken = new Set(existing.map((f) => f.name));
  const freeName = (base: string) => {
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    taken.add(name);
    return name;
  };
  const missing = [...keys].filter((key) => !featureId.has(key));
  if (missing.length > 0) {
    const created = await tx
      .insert(features)
      .values(missing.map((key) => ({ projectId, key, name: freeName(nameOf.get(key) ?? key) })))
      .returning({ id: features.id, key: features.key });
    for (const f of created) featureId.set(f.key as string, f.id);
  }
  const fileRows = await tx
    .select({ id: files.id, path: files.path })
    .from(files)
    .where(eq(files.projectId, projectId));
  const fileId = new Map(fileRows.map((f) => [f.path, f.id]));
  const idOf = (path: string) => {
    const id = fileId.get(path);
    if (!id) throw new Error(`feature map path is not a stored file: ${path}`);
    return id;
  };
  const userPlaced = new Set(
    (
      await tx
        .select({ fileId: featureFiles.fileId })
        .from(featureFiles)
        .where(and(eq(featureFiles.projectId, projectId), eq(featureFiles.placedBy, "user")))
    ).map((l) => l.fileId),
  );
  const links = [
    ...map.features.flatMap((f) =>
      f.files.map((path) => ({ role: "primary" as const, key: f.key, path })),
    ),
    ...map.shared.flatMap((s) =>
      s.usedBy.map((key) => ({ role: "shared" as const, key, path: s.path })),
    ),
  ]
    .map((l) => ({
      projectId,
      featureId: featureId.get(l.key) as string,
      fileId: idOf(l.path),
      role: l.role,
    }))
    .filter((l) => !userPlaced.has(l.fileId));
  const autoFiles = [...new Set(links.map((l) => l.fileId))];
  if (autoFiles.length === 0) return;
  await tx
    .delete(featureFiles)
    .where(
      and(
        eq(featureFiles.projectId, projectId),
        eq(featureFiles.placedBy, "auto"),
        inArray(featureFiles.fileId, autoFiles),
      ),
    );
  for (let i = 0; i < links.length; i += LINK_BATCH)
    await tx.insert(featureFiles).values(links.slice(i, i + LINK_BATCH));
}
