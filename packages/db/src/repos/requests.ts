import { desc, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type ChecklistItem,
  type NewRequest,
  type Request as RequestRow,
  checklistItems,
  requests,
} from "../schema";

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

  // FEAT-012: the request and its checklist items in one transaction (both or neither are stored).
  async createWithItems(
    db: BrainDb,
    projectId: string,
    data: { featureId: string; text: string },
    items: { text: string; needsClarification: boolean }[],
  ): Promise<{ request: RequestRow; items: ChecklistItem[] }> {
    return db.transaction(async (tx) => {
      const [request] = await tx
        .insert(requests)
        .values({ projectId, featureId: data.featureId, text: data.text })
        .returning();
      if (!request) throw new Error("insert requests returned no row");
      const rows =
        items.length === 0
          ? []
          : await tx
              .insert(checklistItems)
              .values(items.map((i) => ({ ...i, projectId, requestId: request.id })))
              .returning();
      return { request, items: rows };
    });
  },
};
