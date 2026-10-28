import { and, count, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type NewSymbol, featureFiles, files, projects, symbols } from "../schema";

export type IndexedSymbol = Omit<NewSymbol, "id" | "projectId" | "fileId" | "createdAt">;
export type IndexedFile = { path: string; hash: string; symbols: IndexedSymbol[] };
export type SummaryUpdate = {
  id: string;
  summary: string | null;
  summaryStatus: "ok" | "empty" | "error" | null;
  summaryAttempts: number;
  summaryAttemptedAt: Date | null;
};

export type StorageCaps = { files: number; symbols: number };
/** The project's totals after a saveFiles call; saved is false when they would pass the caps (nothing changed). */
export type StorageResult = { saved: boolean; files: number; symbols: number };

const INSERT_BATCH = 500;

// The CLI index upload (FEAT-008): metadata only (paths, hashes, symbol names/signatures/summaries), never source.
export const codeIndexRepo = {
  /** Stored hash per path for the given paths of one project (paths not stored are absent). */
  async hashes(db: BrainDb, projectId: string, paths: string[]): Promise<Map<string, string>> {
    if (paths.length === 0) return new Map();
    const rows = await db
      .select({ path: files.path, hash: files.hash })
      .from(files)
      .where(and(eq(files.projectId, projectId), inArray(files.path, paths)));
    return new Map(rows.map((r) => [r.path, r.hash]));
  },

  /**
   * Upserts the files and replaces all their symbols, in one transaction. With caps (M2) the project's totals after
   * the batch are checked first, under a lock on the project row so parallel uploads cannot pass the caps together.
   */
  async saveFiles(
    db: BrainDb,
    projectId: string,
    input: IndexedFile[],
    caps?: StorageCaps,
  ): Promise<StorageResult> {
    if (input.length === 0) return { saved: true, files: 0, symbols: 0 };
    return db.transaction(async (tx) => {
      let totals = { files: 0, symbols: 0 };
      if (caps) {
        await tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, projectId))
          .for("update");
        const paths = input.map((f) => f.path);
        const [stored] = await tx
          .select({ n: count() })
          .from(files)
          .where(eq(files.projectId, projectId));
        const [inBatch] = await tx
          .select({ n: count() })
          .from(files)
          .where(and(eq(files.projectId, projectId), inArray(files.path, paths)));
        // Symbols of files outside the batch stay; the batch's files get exactly the uploaded symbols.
        const [kept] = await tx
          .select({ n: count() })
          .from(symbols)
          .innerJoin(
            files,
            and(eq(files.projectId, symbols.projectId), eq(files.id, symbols.fileId)),
          )
          .where(and(eq(symbols.projectId, projectId), notInArray(files.path, paths)));
        totals = {
          files: (stored?.n ?? 0) + input.length - (inBatch?.n ?? 0),
          symbols: (kept?.n ?? 0) + input.reduce((n, f) => n + f.symbols.length, 0),
        };
        if (totals.files > caps.files || totals.symbols > caps.symbols)
          return { saved: false, ...totals };
      }
      const saved = await tx
        .insert(files)
        .values(input.map((f) => ({ projectId, path: f.path, hash: f.hash })))
        .onConflictDoUpdate({
          target: [files.projectId, files.path],
          set: { hash: sql`excluded.hash` },
        })
        .returning({ id: files.id, path: files.path });
      const idByPath = new Map(saved.map((r) => [r.path, r.id]));
      await tx.delete(symbols).where(
        and(
          eq(symbols.projectId, projectId),
          inArray(
            symbols.fileId,
            saved.map((r) => r.id),
          ),
        ),
      );
      const rows = input.flatMap((f) =>
        f.symbols.map((s) => ({ ...s, projectId, fileId: idByPath.get(f.path) as string })),
      );
      for (let i = 0; i < rows.length; i += INSERT_BATCH) {
        await tx.insert(symbols).values(rows.slice(i, i + INSERT_BATCH));
      }
      return { saved: true, ...totals };
    });
  },

  /** Writes summary results in one statement; ids outside the project are ignored. */
  async saveSummaries(db: BrainDb, projectId: string, rows: SummaryUpdate[]): Promise<void> {
    if (rows.length === 0) return;
    const values = sql.join(
      rows.map(
        (r) =>
          sql`(${r.id}::text, ${r.summary}::text, ${r.summaryStatus}::text, ${r.summaryAttempts}::int, ${r.summaryAttemptedAt?.toISOString() ?? null}::timestamptz)`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE symbols AS s
      SET summary = v.summary, summary_status = v.status, summary_attempts = v.attempts,
          summary_attempted_at = v.attempted_at
      FROM (VALUES ${values}) AS v(id, summary, status, attempts, attempted_at)
      WHERE s.project_id = ${projectId} AND s.id = v.id`);
  },
  /**
   * KI-024: deletes this project's files whose path is in the range (after, through] (null = open end) and not in
   * keep, with their symbols and feature links (FK cascade). Byte order (COLLATE "C"), like the CLI's sort.
   * KI-025: with a folder only paths inside folder/ are deleted.
   * M1: a file the user placed in a feature by hand is never deleted this way (its link would be lost for good).
   * Returns the deleted paths in byte order.
   */
  async removeMissing(
    db: BrainDb,
    projectId: string,
    range: { after: string | null; through: string | null; folder?: string | null; keep: string[] },
  ): Promise<string[]> {
    const bytes = (column: typeof files.path) => sql`${column} COLLATE "C"`;
    const rows = await db
      .delete(files)
      .where(
        and(
          eq(files.projectId, projectId),
          range.after === null ? undefined : sql`${bytes(files.path)} > ${range.after} COLLATE "C"`,
          range.through === null
            ? undefined
            : sql`${bytes(files.path)} <= ${range.through} COLLATE "C"`,
          range.folder == null ? undefined : sql`starts_with(${files.path}, ${`${range.folder}/`})`,
          range.keep.length === 0 ? undefined : notInArray(files.path, range.keep),
          sql`NOT EXISTS (SELECT 1 FROM ${featureFiles} WHERE ${featureFiles.projectId} = ${files.projectId}
            AND ${featureFiles.fileId} = ${files.id} AND ${featureFiles.placedBy} = 'user')`,
        ),
      )
      .returning({ path: files.path });
    const paths = rows.map((r) => r.path);
    return paths.sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)));
  },
};
