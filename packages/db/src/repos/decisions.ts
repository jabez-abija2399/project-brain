import { desc, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type Decision, type NewDecision, decisions } from "../schema";

export const decisionsRepo = {
  async insert(
    db: BrainDb,
    projectId: string,
    data: Omit<NewDecision, "projectId">,
  ): Promise<Decision> {
    const [row] = await db
      .insert(decisions)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert decisions returned no row");
    return row;
  },

  // Newest first. The caller picks the page size (the handoff note uses 5, the list tool up to 50).
  async listNewest(db: BrainDb, projectId: string, limit: number): Promise<Decision[]> {
    return db
      .select()
      .from(decisions)
      .where(eq(decisions.projectId, projectId))
      .orderBy(desc(decisions.createdAt), desc(decisions.id))
      .limit(limit);
  },
};
