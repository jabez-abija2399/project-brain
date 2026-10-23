import { and, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type Feature, type NewFeature, features } from "../schema";

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

  async byName(db: BrainDb, projectId: string, name: string): Promise<Feature | null> {
    const rows = await db
      .select()
      .from(features)
      .where(and(eq(features.projectId, projectId), eq(features.name, name)))
      .limit(1);
    return rows[0] ?? null;
  },
};
