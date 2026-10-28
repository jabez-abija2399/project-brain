import { componentHash, maskSecretsIn, withPreviousSummaries } from "@brain/core";
import { type BrainDb, codeIndexRepo, symbolsRepo } from "@brain/db";
import type { z } from "zod";
import type { diffSchema, uploadSchema } from "./code-index-input";
import { projectStorageCaps } from "./code-index-limits";
import { asPrevious } from "./code-index-summarize";
import { AppError } from "./errors";

// The index routes' entry point: limits, input parsing and summarizing live in the code-index-*.ts files.
export * from "./code-index-input";
export * from "./code-index-limits";
export * from "./code-index-summarize";
export * from "./code-index-features";

/**
 * changed: paths whose stored hash differs or that are not stored yet, in request order. deleted (KI-024, only with a
 * range): stored paths in the range that the request does not list; they are removed with their symbols.
 * held (KI-027): such paths the user placed in a feature by hand; the CLI repeats the diff with final after its
 * uploads, which deletes them and moves the placement to an uploaded file with the same hash (a rename).
 */
export async function diffFiles(
  db: BrainDb,
  projectId: string,
  input: z.infer<typeof diffSchema>,
): Promise<{ changed: string[]; deleted: string[]; held?: string[] }> {
  const paths = input.files.map((f) => f.path);
  const stored = await codeIndexRepo.hashes(db, projectId, paths);
  const changed = input.files.filter((f) => stored.get(f.path) !== f.hash).map((f) => f.path);
  if (input.after === undefined || input.through === undefined) return { changed, deleted: [] };
  const { deleted, held } = await codeIndexRepo.removeMissing(db, projectId, {
    after: input.after,
    through: input.through,
    folder: input.folder ?? null,
    keep: paths,
    final: input.final === true,
  });
  return held.length > 0 ? { changed, deleted, held } : { changed, deleted };
}

// Replaces the batch's files and symbols. Components whose summary inputs did not change keep their summary and
// attempt state (KI-022), so a re-upload never causes a new AI call for them. A batch that would take the project
// past its storage caps (M2) is a 413 and stores nothing.
export async function saveIndexBatch(
  db: BrainDb,
  projectId: string,
  input: z.infer<typeof uploadSchema>,
): Promise<void> {
  const previous = asPrevious(
    await symbolsRepo.listComponents(db, projectId, { paths: input.files.map((f) => f.path) }),
  );
  const files = input.files.map((f) => {
    const components = withPreviousSummaries(
      f.symbols
        .filter((s) => s.kind === "component")
        .map((s) => ({
          path: f.path,
          name: maskSecretsIn(s.name),
          signature: maskSecretsIn(s.signature),
        })),
      previous,
    );
    const routes = f.symbols
      .filter((s) => s.kind === "route")
      .map((s) => ({
        kind: "route",
        name: maskSecretsIn(s.name),
        signature: maskSecretsIn(s.signature),
        summary: null,
        hash: null,
      }));
    return {
      path: f.path,
      hash: f.hash,
      imports: f.imports,
      symbols: [
        ...components.map((c) => ({
          kind: "component",
          name: c.name,
          signature: c.signature,
          summary: c.summary,
          hash: componentHash(c),
          summaryStatus: c.summaryStatus,
          summaryAttempts: c.summaryAttempts,
          summaryAttemptedAt: c.summaryAttemptedAt,
        })),
        ...routes,
      ],
    };
  });
  const caps = projectStorageCaps();
  const stored = await codeIndexRepo.saveFiles(db, projectId, files, caps);
  if (!stored.saved) {
    const n = (x: number) => x.toLocaleString("en-US");
    throw new AppError(
      413,
      "project_storage_full",
      `this project can store at most ${n(caps.files)} files and ${n(caps.symbols)} symbols; this upload would make it ${n(stored.files)} files and ${n(stored.symbols)} symbols`,
    );
  }
}
