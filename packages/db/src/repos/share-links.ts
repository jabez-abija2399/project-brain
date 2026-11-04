import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { projects, receiptShareLinks, receipts, requests, users } from "../schema";

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

  /**
   * Creates a link unless the project already has `max` active ones (null then). The count and the insert run under
   * one per-project lock, so parallel requests cannot pass the cap.
   */
  async createCapped(
    db: BrainDb,
    projectId: string,
    receiptId: string,
    tokenHash: string,
    max: number,
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`share:${projectId}`}, 0))`,
      );
      const [n] = await tx
        .select({ n: count() })
        .from(receiptShareLinks)
        .where(
          and(eq(receiptShareLinks.projectId, projectId), isNull(receiptShareLinks.revokedAt)),
        );
      if ((n?.n ?? 0) >= max) return null;
      const [row] = await tx
        .insert(receiptShareLinks)
        .values({ projectId, receiptId, tokenHash })
        .returning({ id: receiptShareLinks.id, createdAt: receiptShareLinks.createdAt });
      if (!row) throw new Error("share link insert returned nothing");
      return row;
    });
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
      // Security review: a suspended project or owner stops its links (they are not revoked, so they come back).
      .innerJoin(projects, eq(projects.id, receipts.projectId))
      .innerJoin(users, eq(users.id, projects.ownerId))
      .leftJoin(
        requests,
        and(eq(requests.id, receipts.requestId), eq(requests.projectId, receipts.projectId)),
      )
      .where(
        and(
          eq(receiptShareLinks.tokenHash, tokenHash),
          isNull(receiptShareLinks.revokedAt),
          isNull(projects.suspendedAt),
          isNull(users.suspendedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  },
};
