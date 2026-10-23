import { and, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type FeatureFile, type NewFeatureFile, featureFiles } from "../schema";

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
};
