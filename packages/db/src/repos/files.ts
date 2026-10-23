import { and, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type File, type NewFile, files } from "../schema";

export const filesRepo = {
  async upsert(db: BrainDb, projectId: string, data: Omit<NewFile, "projectId">): Promise<File> {
    const [row] = await db
      .insert(files)
      .values({ ...data, projectId })
      .onConflictDoUpdate({
        target: [files.projectId, files.path],
        set: { hash: data.hash },
      })
      .returning();
    if (!row) throw new Error("upsert files returned no row");
    return row;
  },

  async insert(db: BrainDb, projectId: string, data: Omit<NewFile, "projectId">): Promise<File> {
    const [row] = await db
      .insert(files)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert files returned no row");
    return row;
  },

  async list(db: BrainDb, projectId: string): Promise<File[]> {
    return db.select().from(files).where(eq(files.projectId, projectId));
  },

  async byPath(db: BrainDb, projectId: string, path: string): Promise<File | null> {
    const rows = await db
      .select()
      .from(files)
      .where(and(eq(files.projectId, projectId), eq(files.path, path)))
      .limit(1);
    return rows[0] ?? null;
  },
};
