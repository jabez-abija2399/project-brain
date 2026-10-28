import { and, asc, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type ChecklistItem, type NewChecklistItem, checklistItems } from "../schema";

export const checklistItemsRepo = {
  // Composite FK rejects a request of another project (0003_link_tables_project_id.sql).
  async insert(
    db: BrainDb,
    projectId: string,
    data: Omit<NewChecklistItem, "projectId">,
  ): Promise<ChecklistItem> {
    const [row] = await db
      .insert(checklistItems)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert checklist_items returned no row");
    return row;
  },

  async listForRequest(
    db: BrainDb,
    projectId: string,
    requestId: string,
  ): Promise<ChecklistItem[]> {
    return db
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.projectId, projectId), eq(checklistItems.requestId, requestId)));
  },

  // Open items of every request in the project (the handoff note shows them as unfinished work).
  async listOpenForProject(
    db: BrainDb,
    projectId: string,
    limit: number,
  ): Promise<ChecklistItem[]> {
    return db
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.projectId, projectId), eq(checklistItems.status, "open")))
      .orderBy(asc(checklistItems.id))
      .limit(limit);
  },
};
