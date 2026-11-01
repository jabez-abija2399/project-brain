import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type NewReceipt, type Receipt, receipts } from "../schema";

export const receiptsRepo = {
  async insert(
    db: BrainDb,
    projectId: string,
    data: Omit<NewReceipt, "projectId">,
  ): Promise<Receipt> {
    const [row] = await db
      .insert(receipts)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert receipts returned no row");
    return row;
  },

  async list(db: BrainDb, projectId: string, limit = 50): Promise<Receipt[]> {
    return db
      .select()
      .from(receipts)
      .where(eq(receipts.projectId, projectId))
      .orderBy(desc(receipts.createdAt))
      .limit(limit);
  },

  /**
   * Owner, 2026-11-01 (Stop hook): removes the session's earlier receipt that a new one replaces. Only a receipt of this
   * project, for the same request (or both without one), made since `since`; anything else is left alone.
   */
  async deleteReplaced(
    db: BrainDb,
    projectId: string,
    receiptId: string,
    requestId: string | null,
    since: Date,
  ): Promise<number> {
    const rows = await db
      .delete(receipts)
      .where(
        and(
          eq(receipts.projectId, projectId),
          eq(receipts.id, receiptId),
          requestId === null ? isNull(receipts.requestId) : eq(receipts.requestId, requestId),
          gte(receipts.createdAt, since),
          // Security review 2026-11-01: a receipt that found secrets or test checks is never replaced, so an agent
          // cannot make its own findings disappear by asking for a cleaner receipt.
          sql`(CASE WHEN jsonb_typeof(${receipts.summaryJson}->'findings') = 'array'
                THEN jsonb_array_length(${receipts.summaryJson}->'findings') ELSE 0 END) = 0`,
          sql`(CASE WHEN jsonb_typeof(${receipts.summaryJson}->'test_integrity'->'flags') = 'array'
                THEN jsonb_array_length(${receipts.summaryJson}->'test_integrity'->'flags') ELSE 0 END) = 0`,
          sql`coalesce(${receipts.summaryJson}->>'findings_omitted', '0') IN ('0', '')`,
        ),
      )
      .returning({ id: receipts.id });
    return rows.length;
  },
};
