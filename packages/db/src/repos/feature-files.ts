import { and, eq, inArray, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type FeatureFile, type NewFeatureFile, featureFiles, features, files } from "../schema";

export const featureFilesRepo = {
  // Composite FKs reject a feature or file of another project (0003_link_tables_project_id.sql).
  async link(
    db: BrainDb,
    projectId: string,
    data: Omit<NewFeatureFile, "projectId">,
  ): Promise<FeatureFile> {
    const [row] = await db
      .insert(featureFiles)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert feature_files returned no row");
    return row;
  },

  async listForFeature(db: BrainDb, projectId: string, featureId: string): Promise<FeatureFile[]> {
    return db
      .select()
      .from(featureFiles)
      .where(and(eq(featureFiles.projectId, projectId), eq(featureFiles.featureId, featureId)));
  },

  async listForFile(db: BrainDb, projectId: string, fileId: string): Promise<FeatureFile[]> {
    return db
      .select()
      .from(featureFiles)
      .where(and(eq(featureFiles.projectId, projectId), eq(featureFiles.fileId, fileId)));
  },

  // FEAT-013: the features each of these stored paths is linked to (primary or shared), in one query.
  async featuresForPaths(
    db: BrainDb,
    projectId: string,
    paths: string[],
  ): Promise<
    {
      path: string;
      featureId: string;
      featureName: string;
      featureKey: string | null;
      role: "primary" | "shared";
    }[]
  > {
    if (paths.length === 0) return [];
    return db
      .select({
        path: files.path,
        featureId: features.id,
        featureName: features.name,
        featureKey: features.key,
        role: featureFiles.role,
      })
      .from(featureFiles)
      .innerJoin(
        files,
        and(eq(files.projectId, featureFiles.projectId), eq(files.id, featureFiles.fileId)),
      )
      .innerJoin(
        features,
        and(
          eq(features.projectId, featureFiles.projectId),
          eq(features.id, featureFiles.featureId),
        ),
      )
      .where(and(eq(featureFiles.projectId, projectId), inArray(files.path, paths)));
  },

  /**
   * Real-test E (2026-11-01): for each folder, the feature most of its indexed files (directly in it) belong to as
   * primary, so a file new in this session (not indexed yet) is grouped with its folder. One grouped query.
   */
  async primaryFeatureByFolder(
    db: BrainDb,
    projectId: string,
    folders: string[],
  ): Promise<Map<string, { featureId: string; featureName: string }>> {
    const dirs = [...new Set(folders.filter((d) => d !== ""))].slice(0, 200);
    if (dirs.length === 0) return new Map();
    const dir = sql<string>`regexp_replace(${files.path}, '/[^/]*$', '')`;
    const rows = await db
      .select({
        dir,
        featureId: features.id,
        featureName: features.name,
        n: sql<number>`count(*)::int`,
      })
      .from(featureFiles)
      .innerJoin(
        files,
        and(eq(files.projectId, featureFiles.projectId), eq(files.id, featureFiles.fileId)),
      )
      .innerJoin(
        features,
        and(
          eq(features.projectId, featureFiles.projectId),
          eq(features.id, featureFiles.featureId),
        ),
      )
      .where(
        and(
          eq(featureFiles.projectId, projectId),
          eq(featureFiles.role, "primary"),
          inArray(dir, dirs),
        ),
      )
      .groupBy(dir, features.id, features.name);
    const out = new Map<string, { featureId: string; featureName: string; n: number }>();
    for (const r of rows) {
      const best = out.get(r.dir);
      // Most files wins; a tie goes to the name first in the alphabet (stable).
      if (!best || r.n > best.n || (r.n === best.n && r.featureName < best.featureName)) {
        out.set(r.dir, { featureId: r.featureId, featureName: r.featureName, n: Number(r.n) });
      }
    }
    return new Map(
      [...out].map(([d, v]) => [d, { featureId: v.featureId, featureName: v.featureName }]),
    );
  },
};
