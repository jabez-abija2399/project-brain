import { desc, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type NewRequest, type Request as RequestRow, requests } from "../schema";

export const requestsRepo = {
  async insert(
    db: BrainDb,
    projectId: string,
    data: Omit<NewRequest, "projectId">,
  ): Promise<RequestRow> {
    const [row] = await db
      .insert(requests)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert requests returned no row");
    return row;
  },

  async list(db: BrainDb, projectId: string, limit = 50): Promise<RequestRow[]> {
    return db
      .select()
      .from(requests)
      .where(eq(requests.projectId, projectId))
      .orderBy(desc(requests.createdAt))
      .limit(limit);
  },
};
