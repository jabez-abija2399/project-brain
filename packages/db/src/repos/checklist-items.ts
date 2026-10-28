import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type ChecklistChange,
  type ChecklistItem,
  type NewChecklistItem,
  checklistItems,
  requests,
} from "../schema";

// Items not done and not dismissed: open, partly done or missed by a receipt (FEAT-013 AC-013-04).
const UNRESOLVED: ChecklistItem["status"][] = ["open", "partial", "missed"];

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
      .where(and(eq(checklistItems.projectId, projectId), eq(checklistItems.requestId, requestId)))
      .orderBy(asc(checklistItems.position), asc(checklistItems.id));
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
      .where(
        and(eq(checklistItems.projectId, projectId), inArray(checklistItems.status, UNRESOLVED)),
      )
      .orderBy(asc(checklistItems.requestId), asc(checklistItems.position), asc(checklistItems.id))
      .limit(limit);
  },

  async byId(db: BrainDb, projectId: string, itemId: string): Promise<ChecklistItem | null> {
    const [row] = await db
      .select()
      .from(checklistItems)
      .where(and(eq(checklistItems.projectId, projectId), eq(checklistItems.id, itemId)))
      .limit(1);
    return row ?? null;
  },

  // Items of a feature's requests that are not dismissed, oldest request first (the context pack lists them).
  async listForFeature(
    db: BrainDb,
    projectId: string,
    featureId: string,
    limit: number,
  ): Promise<ChecklistItem[]> {
    return db
      .select({ item: checklistItems })
      .from(checklistItems)
      .innerJoin(
        requests,
        and(
          eq(requests.projectId, checklistItems.projectId),
          eq(requests.id, checklistItems.requestId),
        ),
      )
      .where(
        and(
          eq(checklistItems.projectId, projectId),
          eq(requests.featureId, featureId),
          ne(checklistItems.status, "dismissed"),
        ),
      )
      .orderBy(asc(requests.createdAt), asc(checklistItems.position), asc(checklistItems.id))
      .limit(limit)
      .then((rows) => rows.map((r) => r.item));
  },

  // FEAT-012: an agent's change is stored as a proposal only; the item's text and status stay as they are.
  async propose(
    db: BrainDb,
    projectId: string,
    itemId: string,
    change: ChecklistChange,
    now: Date,
  ): Promise<ChecklistItem | null> {
    const [row] = await db
      .update(checklistItems)
      .set({ proposedChange: change, proposedAt: now })
      .where(
        and(
          eq(checklistItems.projectId, projectId),
          eq(checklistItems.id, itemId),
          ne(checklistItems.status, "dismissed"),
        ),
      )
      .returning();
    return row ?? null;
  },

  // The owner confirmed: apply the proposal once (row lock), then clear it. Null when the item does not exist.
  async applyProposal(
    db: BrainDb,
    projectId: string,
    itemId: string,
  ): Promise<{ kind: "applied"; item: ChecklistItem } | { kind: "no_proposal" } | null> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(checklistItems)
        .where(and(eq(checklistItems.projectId, projectId), eq(checklistItems.id, itemId)))
        .for("update");
      if (!row) return null;
      const change = row.proposedChange;
      if (!change) return { kind: "no_proposal" as const };
      const [updated] = await tx
        .update(checklistItems)
        .set({
          ...("text" in change ? { text: change.text } : { status: "dismissed" as const }),
          proposedChange: null,
          proposedAt: null,
        })
        .where(and(eq(checklistItems.projectId, projectId), eq(checklistItems.id, itemId)))
        .returning();
      if (!updated) throw new Error("update checklist_items returned no row");
      return { kind: "applied" as const, item: updated };
    });
  },

  // The request's items a receipt still judges (not done, not dismissed), in creation order.
  async listUnresolvedForRequest(
    db: BrainDb,
    projectId: string,
    requestId: string,
  ): Promise<ChecklistItem[]> {
    return db
      .select()
      .from(checklistItems)
      .where(
        and(
          eq(checklistItems.projectId, projectId),
          eq(checklistItems.requestId, requestId),
          inArray(checklistItems.status, UNRESOLVED),
        ),
      )
      .orderBy(asc(checklistItems.position), asc(checklistItems.id));
  },

  // One statement for every item of a receipt; items of another project are never touched.
  async setStatuses(
    db: BrainDb,
    projectId: string,
    updates: { id: string; status: "done" | "partial" | "missed" }[],
  ): Promise<void> {
    if (updates.length === 0) return;
    const values = sql.join(
      updates.map((u) => sql`(${u.id}, ${u.status})`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE checklist_items AS c SET status = v.status
      FROM (VALUES ${values}) AS v(id, status)
      WHERE c.project_id = ${projectId} AND c.id = v.id AND c.status IN ('open', 'partial', 'missed')`);
  },
};
