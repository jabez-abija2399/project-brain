import { and, count, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type NewSymbol, featureFiles, files, symbols } from "../schema";

export type IndexedSymbol = Omit<NewSymbol, "id" | "projectId" | "fileId" | "createdAt">;
export type IndexedFile = {
  path: string;
  hash: string;
  symbols: IndexedSymbol[];
  /** Repo paths the file imports (FEAT-006 grouping). */
  imports?: string[];
};
/** What feature grouping reads: every stored file's imports and its route symbols (URL + method). */
export type GroupingInput = {
  files: { path: string; imports: string[] }[];
  routes: { file: string; path: string; method: string }[];
};
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
  /**
   * Stored hash per path for the given paths of one project (paths not stored are absent). A row without recorded
   * imports (indexed before 0010) is absent too, so the CLI uploads it again.
   */
  async hashes(db: BrainDb, projectId: string, paths: string[]): Promise<Map<string, string>> {
    if (paths.length === 0) return new Map();
    const rows = await db
      .select({ path: files.path, hash: files.hash })
      .from(files)
      .where(
        and(eq(files.projectId, projectId), inArray(files.path, paths), isNotNull(files.imports)),
      );
    return new Map(rows.map((r) => [r.path, r.hash]));
  },

  /**
   * Upserts the files and replaces all their symbols, in one transaction. With caps (M2) the project's totals after
   * the batch are checked first, under a per-project advisory lock so parallel uploads cannot pass the caps together.
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
        // A per-project advisory lock (not the project row, so dashboard file moves are not blocked by uploads).
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`storage:${projectId}`}, 0))`,
        );
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
        .values(
          input.map((f) => ({ projectId, path: f.path, hash: f.hash, imports: f.imports ?? [] })),
        )
        .onConflictDoUpdate({
          target: [files.projectId, files.path],
          set: { hash: sql`excluded.hash`, imports: sql`excluded.imports` },
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

  /** Paths with imports and route symbols of all the project's files (FEAT-006 grouping), in path order. */
  async groupingInput(db: BrainDb, projectId: string): Promise<GroupingInput> {
    const rows = await db
      .select({ path: files.path, imports: files.imports })
      .from(files)
      .where(eq(files.projectId, projectId))
      .orderBy(files.path);
    const routes = await db
      .select({ file: files.path, path: symbols.name, method: symbols.signature })
      .from(symbols)
      .innerJoin(files, and(eq(files.projectId, symbols.projectId), eq(files.id, symbols.fileId)))
      .where(and(eq(symbols.projectId, projectId), eq(symbols.kind, "route")))
      .orderBy(files.path, symbols.name);
    return {
      files: rows.map((r) => ({ path: r.path, imports: r.imports ?? [] })),
      routes: routes.map((r) => ({ ...r, method: r.method ?? "page" })),
    };
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
   * KI-027: a file the user placed in a feature by hand is only held (returned, not deleted) unless final; a final call
   * (after the run's uploads) deletes it and first moves its user links to a stored file with the same hash that is
   * not being deleted and has no user link (a rename), so the placement is not lost.
   * Returns the deleted and held paths in byte order.
   */
  async removeMissing(
    db: BrainDb,
    projectId: string,
    range: {
      after: string | null;
      through: string | null;
      folder?: string | null;
      keep: string[];
      final?: boolean;
      // FEAT-009: only these exact paths (files a push removed); with it, after/through are usually null.
      only?: string[];
    },
  ): Promise<{ deleted: string[]; held: string[] }> {
    if (range.only !== undefined && range.only.length === 0) return { deleted: [], held: [] };
    const bytes = (column: typeof files.path) => sql`${column} COLLATE "C"`;
    const placedByUser = (fileId: typeof files.id) =>
      sql`EXISTS (SELECT 1 FROM ${featureFiles} WHERE ${featureFiles.projectId} = ${files.projectId}
        AND ${featureFiles.fileId} = ${fileId} AND ${featureFiles.placedBy} = 'user')`;
    const byteSorted = (paths: string[]) =>
      paths.sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)));
    return db.transaction(async (tx) => {
      const missing = await tx
        .select({
          id: files.id,
          path: files.path,
          hash: files.hash,
          placed: placedByUser(files.id),
        })
        .from(files)
        .where(
          and(
            eq(files.projectId, projectId),
            range.after === null
              ? undefined
              : sql`${bytes(files.path)} > ${range.after} COLLATE "C"`,
            range.through === null
              ? undefined
              : sql`${bytes(files.path)} <= ${range.through} COLLATE "C"`,
            range.folder == null
              ? undefined
              : sql`starts_with(${files.path}, ${`${range.folder}/`})`,
            range.keep.length === 0 ? undefined : notInArray(files.path, range.keep),
            range.only === undefined ? undefined : inArray(files.path, range.only),
          ),
        )
        .for("update");
      const placed = missing.filter((f) => f.placed);
      const doomed = range.final ? missing : missing.filter((f) => !f.placed);
      if (range.final && placed.length > 0) {
        const doomedIds = missing.map((f) => f.id);
        const candidates = await tx
          .select({ id: files.id, path: files.path, hash: files.hash })
          .from(files)
          .where(
            and(
              eq(files.projectId, projectId),
              inArray(
                files.hash,
                placed.map((f) => f.hash),
              ),
              notInArray(files.id, doomedIds),
              sql`NOT ${placedByUser(files.id)}`,
            ),
          );
        candidates.sort((x, y) => Buffer.compare(Buffer.from(x.path), Buffer.from(y.path)));
        for (const from of placed) {
          const to = candidates.find((c) => c.hash === from.hash);
          if (!to) continue;
          candidates.splice(candidates.indexOf(to), 1);
          await tx
            .delete(featureFiles)
            .where(and(eq(featureFiles.projectId, projectId), eq(featureFiles.fileId, to.id)));
          await tx
            .update(featureFiles)
            .set({ fileId: to.id })
            .where(
              and(
                eq(featureFiles.projectId, projectId),
                eq(featureFiles.fileId, from.id),
                eq(featureFiles.placedBy, "user"),
              ),
            );
        }
      }
      if (doomed.length > 0)
        await tx.delete(files).where(
          and(
            eq(files.projectId, projectId),
            inArray(
              files.id,
              doomed.map((f) => f.id),
            ),
          ),
        );
      return {
        deleted: byteSorted(doomed.map((f) => f.path)),
        held: range.final ? [] : byteSorted(placed.map((f) => f.path)),
      };
    });
  },
};
