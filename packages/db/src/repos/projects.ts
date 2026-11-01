import { and, desc, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type NewProject, type Project, projects, users } from "../schema";
import { type Page, type PageOptions, pageBounds, toPage } from "./page";

export const projectsRepo = {
  async create(db: BrainDb, ownerId: string, data: Omit<NewProject, "ownerId">): Promise<Project> {
    const [row] = await db
      .insert(projects)
      .values({ ...data, ownerId })
      .returning();
    if (!row) throw new Error("insert projects returned no row");
    return row;
  },

  /** Whether a project or its owner is suspended (token requests check this; one query). */
  async suspensionOf(
    db: BrainDb,
    projectId: string,
  ): Promise<{ project: boolean; owner: boolean } | null> {
    const [row] = await db
      .select({ p: projects.suspendedAt, u: users.suspendedAt })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.ownerId))
      .where(eq(projects.id, projectId))
      .limit(1);
    return row ? { project: Boolean(row.p), owner: Boolean(row.u) } : null;
  },

  async get(db: BrainDb, projectId: string, ownerId: string): Promise<Project | null> {
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async listByOwner(db: BrainDb, ownerId: string, opts?: PageOptions): Promise<Page<Project>> {
    const { limit, offset } = pageBounds(opts);
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.ownerId, ownerId))
      .orderBy(desc(projects.createdAt), desc(projects.id))
      .limit(limit + 1)
      .offset(offset);
    return toPage(rows, limit, offset);
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
