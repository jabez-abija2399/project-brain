import { desc, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type AgentSession, type NewAgentSession, agentSessions } from "../schema";

export const agentSessionsRepo = {
  async insert(
    db: BrainDb,
    projectId: string,
    data: Omit<NewAgentSession, "projectId">,
  ): Promise<AgentSession> {
    const [row] = await db
      .insert(agentSessions)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert agent_sessions returned no row");
    return row;
  },

  // Newest first; ties on createdAt are broken by id so the order is stable. The caller picks the page size.
  async listNewest(db: BrainDb, projectId: string, limit: number): Promise<AgentSession[]> {
    return db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.projectId, projectId))
      .orderBy(desc(agentSessions.createdAt), desc(agentSessions.id))
      .limit(limit);
  },
};
