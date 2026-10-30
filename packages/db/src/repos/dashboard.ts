import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { features, files, receipts, requests } from "../schema";

// FEAT-017 dashboard reads: one bounded query per page (no query per row), scoped by project.
export type BoardRow = {
  id: string;
  name: string;
  status: string;
  files: number;
  openItems: number;
  lastReceiptAt: Date | null;
};

export type FeedRow = {
  id: string;
  requestId: string | null;
  asked: string | null;
  commitSha: string | null;
  summaryJson: unknown;
  createdAt: Date;
};

export const dashboardRepo = {
  /** Features with primary file count, unresolved checklist items and their last receipt, by name. */
  async featureBoard(
    db: BrainDb,
    projectId: string,
    limit: number,
    offset: number,
  ): Promise<{ rows: BoardRow[]; total: number }> {
    // Static SQL with explicit aliases (no input): drizzle would print the inner columns unqualified, which Postgres
    // reads as ambiguous between the subquery and the outer features row.
    const fileCount = sql<number>`(
      SELECT count(*)::int FROM feature_files ff
      WHERE ff.project_id = features.project_id AND ff.feature_id = features.id AND ff.role = 'primary')`;
    const openItems = sql<number>`(
      SELECT count(*)::int FROM checklist_items ci
      JOIN requests rq ON rq.id = ci.request_id AND rq.project_id = ci.project_id
      WHERE ci.project_id = features.project_id AND rq.feature_id = features.id
        AND ci.status IN ('open', 'partial', 'missed'))`;
    const lastReceiptAt = sql<Date | null>`(
      SELECT max(rc.created_at) FROM receipts rc
      JOIN requests rq ON rq.id = rc.request_id AND rq.project_id = rc.project_id
      WHERE rc.project_id = features.project_id AND rq.feature_id = features.id)`;
    const [rows, [n]] = await Promise.all([
      db
        .select({
          id: features.id,
          name: features.name,
          status: features.status,
          files: fileCount,
          openItems,
          lastReceiptAt,
        })
        .from(features)
        .where(eq(features.projectId, projectId))
        .orderBy(asc(features.name), asc(features.id))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(features).where(eq(features.projectId, projectId)),
    ]);
    return {
      rows: rows.map((r) => ({
        ...r,
        files: Number(r.files),
        openItems: Number(r.openItems),
        lastReceiptAt: r.lastReceiptAt ? new Date(r.lastReceiptAt) : null,
      })),
      total: n?.n ?? 0,
    };
  },

  /** Receipts newest first with the request they answer ("asked"). */
  async receiptsFeed(
    db: BrainDb,
    projectId: string,
    limit: number,
    offset: number,
  ): Promise<{ rows: FeedRow[]; total: number }> {
    const [rows, [n]] = await Promise.all([
      db
        .select({
          id: receipts.id,
          requestId: receipts.requestId,
          asked: requests.text,
          commitSha: receipts.commitSha,
          summaryJson: receipts.summaryJson,
          createdAt: receipts.createdAt,
        })
        .from(receipts)
        .leftJoin(
          requests,
          and(eq(requests.id, receipts.requestId), eq(requests.projectId, receipts.projectId)),
        )
        .where(eq(receipts.projectId, projectId))
        .orderBy(desc(receipts.createdAt), desc(receipts.id))
        .limit(limit)
        .offset(offset),
      db.select({ n: count() }).from(receipts).where(eq(receipts.projectId, projectId)),
    ]);
    return { rows, total: n?.n ?? 0 };
  },

  /** Indexed files of the project: 0 until the first `codeceipt index` (connect page). */
  async indexedFiles(db: BrainDb, projectId: string): Promise<number> {
    const [n] = await db.select({ n: count() }).from(files).where(eq(files.projectId, projectId));
    return n?.n ?? 0;
  },
};
