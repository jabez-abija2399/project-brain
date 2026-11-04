import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { BrainDb } from "../db";
import { receiptShareLinks, receipts, requests } from "../schema";

// FEAT-021: share links. Every query is scoped to a project except findActiveByHash, which is the public lookup (by
// the token's hash only) and returns just the receipt it points at.
export const shareLinksRepo = {
  async receiptInProject(db: BrainDb, projectId: string, receiptId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: receipts.id })
      .from(receipts)
      .where(and(eq(receipts.id, receiptId), eq(receipts.projectId, projectId)))
      .limit(1);
    return Boolean(row);
  },

  async activeCount(db: BrainDb, projectId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(receiptShareLinks)
      .where(and(eq(receiptShareLinks.projectId, projectId), isNull(receiptShareLinks.revokedAt)));
    return row?.n ?? 0;
  },

  async create(db: BrainDb, projectId: string, receiptId: string, tokenHash: string) {
    const [row] = await db
      .insert(receiptShareLinks)
      .values({ projectId, receiptId, tokenHash })
      .returning({ id: receiptShareLinks.id, createdAt: receiptShareLinks.createdAt });
    if (!row) throw new Error("share link insert returned nothing");
    return row;
  },

  /** Revokes an active link of this project; false when there is none. */
  async revoke(db: BrainDb, projectId: string, linkId: string): Promise<boolean> {
    const rows = await db
      .update(receiptShareLinks)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(receiptShareLinks.id, linkId),
          eq(receiptShareLinks.projectId, projectId),
          isNull(receiptShareLinks.revokedAt),
        ),
      )
      .returning({ id: receiptShareLinks.id });
    return rows.length > 0;
  },

  /** Active links for some receipts of a project (no tokens: they are never stored). */
  async activeForReceipts(db: BrainDb, projectId: string, receiptIds: string[]) {
    if (receiptIds.length === 0) return [];
    return db
      .select({
        id: receiptShareLinks.id,
        receiptId: receiptShareLinks.receiptId,
        createdAt: receiptShareLinks.createdAt,
      })
      .from(receiptShareLinks)
      .where(
        and(
          eq(receiptShareLinks.projectId, projectId),
          inArray(receiptShareLinks.receiptId, receiptIds),
          isNull(receiptShareLinks.revokedAt),
        ),
      )
      .orderBy(desc(receiptShareLinks.createdAt));
  },

  /** The receipt behind an active link, by the token's hash; null when unknown or revoked. */
  async findActiveByHash(db: BrainDb, tokenHash: string) {
    const [row] = await db
      .select({
        tokenHash: receiptShareLinks.tokenHash,
        projectId: receipts.projectId,
        receiptId: receipts.id,
        asked: requests.text,
        commitSha: receipts.commitSha,
        summaryJson: receipts.summaryJson,
        createdAt: receipts.createdAt,
      })
      .from(receiptShareLinks)
      .innerJoin(
        receipts,
        and(
          eq(receipts.id, receiptShareLinks.receiptId),
          eq(receipts.projectId, receiptShareLinks.projectId),
        ),
      )
      .leftJoin(
        requests,
        and(eq(requests.id, receipts.requestId), eq(requests.projectId, receipts.projectId)),
      )
      .where(and(eq(receiptShareLinks.tokenHash, tokenHash), isNull(receiptShareLinks.revokedAt)))
      .limit(1);
    return row ?? null;
  },
};
