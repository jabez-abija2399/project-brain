import { and, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type NewProject, type Project, projects } from "../schema";

export const projectsRepo = {
  async create(db: BrainDb, ownerId: string, data: Omit<NewProject, "ownerId">): Promise<Project> {
    const [row] = await db
      .insert(projects)
      .values({ ...data, ownerId })
      .returning();
    if (!row) throw new Error("insert projects returned no row");
    return row;
  },

  async get(db: BrainDb, projectId: string, ownerId: string): Promise<Project | null> {
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async listByOwner(db: BrainDb, ownerId: string): Promise<Project[]> {
    return db.select().from(projects).where(eq(projects.ownerId, ownerId));
  },

  async delete(db: BrainDb, projectId: string, ownerId: string): Promise<void> {
    await db.delete(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
  },

  async rename(
    db: BrainDb,
    projectId: string,
    ownerId: string,
    name: string,
  ): Promise<Project | null> {
    const [row] = await db
      .update(projects)
      .set({ name })
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
      .returning();
    return row ?? null;
  },
};
