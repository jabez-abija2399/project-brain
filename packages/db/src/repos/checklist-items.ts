import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type ChecklistChange,
  type ChecklistItem,
  type NewChecklistItem,
  checklistItems,
  requests,
} from "../schema";

// Items a receipt still judges: open, partly done, missed, or done without a test (FEAT-013 AC-013-04, AC-013-07).
const UNRESOLVED: ChecklistItem["status"][] = ["open", "partial", "missed", "done_untested"];
// What a receipt lists for its request: the items it judges, and the postponed ones it shows but never judges.
const ON_RECEIPT: ChecklistItem["status"][] = [...UNRESOLVED, "postponed"];

// The proposal the owner saw: when it was made and what it changes. Confirming or rejecting checks both, so a proposal
// replaced between viewing and clicking is never applied by mistake.
export type ShownProposal = { proposedAt: Date; change: ChecklistChange };
function sameProposal(row: ChecklistItem, shown: ShownProposal): boolean {
  return (
    row.proposedAt?.getTime() === shown.proposedAt.getTime() &&
    JSON.stringify(row.proposedChange) === JSON.stringify(shown.change)
  );
}

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
  /**
   * The start note's items from earlier sessions: everything not done and not dismissed (open, partial, missed, done
   * without a test, postponed), newest request first, with the request's time so duplicates keep the newest.
   */
  async listOpenForProject(
    db: BrainDb,
    projectId: string,
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
        and(eq(checklistItems.projectId, projectId), inArray(checklistItems.status, ON_RECEIPT)),
      )
      .orderBy(
        desc(requests.createdAt),
        desc(requests.id),
        asc(checklistItems.position),
        asc(checklistItems.id),
      )
      .limit(limit)
      .then((rows) => rows.map((r) => r.item));
  },

  /** Lower-cased texts, among `texts`, of items already done in another request (a receipt with no changed files). */
  async doneElsewhere(
    db: BrainDb,
    projectId: string,
    requestId: string,
    texts: string[],
  ): Promise<Set<string>> {
    if (texts.length === 0) return new Set();
    const lowered = [...new Set(texts.map((t) => t.toLowerCase()))].slice(0, 50);
    const rows = await db
      .select({ text: checklistItems.text })
      .from(checklistItems)
      .where(
        and(
          eq(checklistItems.projectId, projectId),
          ne(checklistItems.requestId, requestId),
          inArray(checklistItems.status, ["done", "done_untested"]),
          inArray(sql`lower(${checklistItems.text})`, lowered),
        ),
      )
      .limit(50);
    return new Set(rows.map((r) => r.text.toLowerCase()));
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

  // The owner confirmed: apply the proposal once (row lock), then clear it. Null when the item does not exist. A
  // proposal that is no longer the one the owner saw (`expected`) is not applied ("changed", FEAT-017). The API always
  // passes `expected` (owner decision 2026-10-29); only internal callers apply the current proposal without it.
  async applyProposal(
    db: BrainDb,
    projectId: string,
    itemId: string,
    expected?: ShownProposal,
  ): Promise<
    { kind: "applied"; item: ChecklistItem } | { kind: "no_proposal" } | { kind: "changed" } | null
  > {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(checklistItems)
        .where(and(eq(checklistItems.projectId, projectId), eq(checklistItems.id, itemId)))
        .for("update");
      if (!row) return null;
      const change = row.proposedChange;
      if (!change) return { kind: "no_proposal" as const };
      if (expected && !sameProposal(row, expected)) return { kind: "changed" as const };
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

  // FEAT-017: the owner rejects the proposal they saw; the item stays as it was. Same results as applyProposal.
  async discardProposal(
    db: BrainDb,
    projectId: string,
    itemId: string,
    expected: ShownProposal,
  ): Promise<
    | { kind: "discarded"; item: ChecklistItem }
    | { kind: "no_proposal" }
    | { kind: "changed" }
    | null
  > {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(checklistItems)
        .where(and(eq(checklistItems.projectId, projectId), eq(checklistItems.id, itemId)))
        .for("update");
      if (!row) return null;
      if (!row.proposedChange) return { kind: "no_proposal" as const };
      if (!sameProposal(row, expected)) return { kind: "changed" as const };
      const [updated] = await tx
        .update(checklistItems)
        .set({ proposedChange: null, proposedAt: null })
        .where(and(eq(checklistItems.projectId, projectId), eq(checklistItems.id, itemId)))
        .returning();
      if (!updated) throw new Error("update checklist_items returned no row");
      return { kind: "discarded" as const, item: updated };
    });
  },

  // FEAT-017: items with a pending proposal, newest proposal first.
  async listProposals(
    db: BrainDb,
    projectId: string,
    limit: number,
    offset: number,
  ): Promise<{ rows: ChecklistItem[]; total: number }> {
    const pending = and(
      eq(checklistItems.projectId, projectId),
      isNotNull(checklistItems.proposedChange),
    );
    const [rows, [n]] = await Promise.all([
      db
        .select()
        .from(checklistItems)
        .where(pending)
        .orderBy(desc(checklistItems.proposedAt), desc(checklistItems.id))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(checklistItems).where(pending),
    ]);
    return { rows, total: n?.n ?? 0 };
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

  // The request's items a receipt lists: the ones it judges and the postponed ones (shown, never judged).
  async listForReceipt(
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
          inArray(checklistItems.status, ON_RECEIPT),
        ),
      )
      .orderBy(asc(checklistItems.position), asc(checklistItems.id));
  },

  // One statement for every item of a receipt; items of another project are never touched.
  async setStatuses(
    db: BrainDb,
    projectId: string,
    updates: { id: string; status: "done" | "partial" | "missed" | "done_untested" }[],
  ): Promise<void> {
    if (updates.length === 0) return;
    const values = sql.join(
      updates.map((u) => sql`(${u.id}, ${u.status})`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE checklist_items AS c SET status = v.status
      FROM (VALUES ${values}) AS v(id, status)
      WHERE c.project_id = ${projectId} AND c.id = v.id AND c.status IN ('open', 'partial', 'missed', 'done_untested')`);
  },

  // H1/H2: every item of the project with its request's time and feature, newest request first. Used to merge near
  // duplicates and by the one-time cleanup; a read only.
  async listWithRequests(
    db: BrainDb,
    projectId: string,
    limit: number,
  ): Promise<{ item: ChecklistItem; requestCreatedAt: Date; requestFeatureId: string | null }[]> {
    const rows = await db
      .select({
        item: checklistItems,
        requestCreatedAt: requests.createdAt,
        requestFeatureId: requests.featureId,
      })
      .from(checklistItems)
      .innerJoin(
        requests,
        and(
          eq(requests.projectId, checklistItems.projectId),
          eq(requests.id, checklistItems.requestId),
        ),
      )
      .where(eq(checklistItems.projectId, projectId))
      .orderBy(
        desc(requests.createdAt),
        desc(requests.id),
        asc(checklistItems.position),
        asc(checklistItems.id),
      )
      .limit(limit);
    return rows;
  },

  // H3 (owner): the item is kept and marked dismissed, never deleted; its pending proposal is dropped with it. Null
  // when the item is not in the project or is already dismissed.
  async dismiss(db: BrainDb, projectId: string, itemId: string): Promise<ChecklistItem | null> {
    const [row] = await db
      .update(checklistItems)
      .set({ status: "dismissed", proposedChange: null, proposedAt: null })
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

  // H1 (2026-11-02): an open item a new request repeats is reused: it moves onto that request (so the request's receipt
  // judges it) at the given position. Only open items of this project move; anything else is left where it is.
  async moveToRequest(
    db: BrainDb,
    projectId: string,
    requestId: string,
    moves: { id: string; position: number }[],
  ): Promise<number> {
    if (moves.length === 0) return 0;
    return db.transaction(async (tx) => {
      // The request must be one of this project's: an id from another project moves nothing.
      const [owned] = await tx
        .select({ id: requests.id })
        .from(requests)
        .where(and(eq(requests.id, requestId), eq(requests.projectId, projectId)))
        .limit(1);
      if (!owned) return 0;
      let moved = 0;
      for (const m of moves) {
        const rows = await tx
          .update(checklistItems)
          .set({ requestId, position: m.position })
          .where(
            and(
              eq(checklistItems.projectId, projectId),
              eq(checklistItems.id, m.id),
              inArray(checklistItems.status, ["open", "partial", "missed", "postponed"]),
            ),
          )
          .returning({ id: checklistItems.id });
        moved += rows.length;
      }
      return moved;
    });
  },

  // H2/H3: closes unresolved items (open, partial, missed, postponed) as done, done without a test, or dismissed, in
  // one transaction. An item already done (or done without a test, which only a later receipt judges) is never
  // touched here. Returns how many items changed.
  async closeItems(
    db: BrainDb,
    projectId: string,
    updates: { id: string; status: "done" | "done_untested" | "dismissed" }[],
  ): Promise<number> {
    if (updates.length === 0) return 0;
    return db.transaction(async (tx) => {
      let changed = 0;
      for (const u of updates) {
        const rows = await tx
          .update(checklistItems)
          .set({ status: u.status, proposedChange: null, proposedAt: null })
          .where(
            and(
              eq(checklistItems.projectId, projectId),
              eq(checklistItems.id, u.id),
              inArray(checklistItems.status, ["open", "partial", "missed", "postponed"]),
            ),
          )
          .returning({ id: checklistItems.id });
        changed += rows.length;
      }
      return changed;
    });
  },
};
