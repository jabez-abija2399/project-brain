import { and, eq, inArray } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type Feature, type NewFeature, featureFiles, features, files } from "../schema";

/** Another feature of the project already has this name (features_project_name_uniq). */
export class FeatureNameTakenError extends Error {
  constructor() {
    super("a feature with this name already exists in the project");
  }
}

class FileNotInProject extends Error {}

function isUniqueViolation(err: unknown): boolean {
  // drizzle wraps the driver error; walk the cause chain for Postgres code 23505.
  for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === "23505") return true;
  }
  return false;
}

/** Feature names map to file paths; paths must already be stored in `files`. */
export type FeatureMapInput = {
  features: { name: string; files: string[] }[];
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

  async byName(db: BrainDb, projectId: string, name: string): Promise<Feature | null> {
    const rows = await db
      .select()
      .from(features)
      .where(and(eq(features.projectId, projectId), eq(features.name, name)))
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * Renames the feature and/or moves files into it as their primary feature (a moved shared file stops
   * being shared), in one transaction. Returns null when the feature or any file is not in the project.
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
          await tx
            .insert(featureFiles)
            .values(
              fileIds.map((fileId) => ({ projectId, featureId, fileId, role: "primary" as const })),
            );
        }
        if (change.name === undefined || change.name === feature.name) return feature;
        const [renamed] = await tx
          .update(features)
          .set({ name: change.name })
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
   * Stores a grouped feature map: creates missing features by name and links each file (primary, or shared
   * to every feature using it). Files that already have a primary feature keep it, so user corrections
   * survive a re-run. Throws when a path is not a stored file of the project.
   */
  async saveMap(db: BrainDb, projectId: string, map: FeatureMapInput): Promise<void> {
    await db.transaction(async (tx) => {
      const names = new Set([
        ...map.features.map((f) => f.name),
        ...map.shared.flatMap((s) => s.usedBy),
      ]);
      if (names.size === 0) return;
      await tx
        .insert(features)
        .values([...names].map((name) => ({ projectId, name })))
        .onConflictDoNothing();
      const featureRows = await tx
        .select({ id: features.id, name: features.name })
        .from(features)
        .where(and(eq(features.projectId, projectId), inArray(features.name, [...names])));
      const featureId = new Map(featureRows.map((f) => [f.name, f.id]));
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
      const links = [
        ...map.features.flatMap((f) =>
          f.files.map((path) => ({ role: "primary" as const, name: f.name, path })),
        ),
        ...map.shared.flatMap((s) =>
          s.usedBy.map((name) => ({ role: "shared" as const, name, path: s.path })),
        ),
      ].map((l) => ({
        projectId,
        featureId: featureId.get(l.name) as string,
        fileId: idOf(l.path),
        role: l.role,
      }));
      if (links.length > 0) await tx.insert(featureFiles).values(links).onConflictDoNothing();
    });
  },
};
