import { type SourceFile, indexSources, pathSkipReason, toUpload } from "@brain/core";
import { type BrainDb, codeIndexRepo, dbTablesRepo, filesRepo, githubRepo } from "@brain/db";
import { groupProject, saveIndexBatch, uploadSchema } from "./code-index";
import type { PushEventData } from "./inngest";

// Files fetched and indexed per step (the spec splits big pushes into steps).
export const PUSH_BATCH_FILES = 100;
// GitHub's compare lists at most 300 files, so a list of 300 or more may be cut short: such a push is not indexed
// incrementally (it needs a full index) and fails closed on RLS.
export const MAX_PUSH_FILES = 299;
// Parallel content requests to GitHub within one step.
const FETCH_CONCURRENCY = 8;
const ZERO_SHA = "0".repeat(40);
const SUPABASE_MIGRATION = /(^|\/)supabase\/migrations\/[^/]+\.sql$/i;

// The subset of an installation Octokit the job uses (a real one in production, a fetch-mocked one in tests).
export type GithubClient = {
  request: (route: string, params?: Record<string, unknown>) => Promise<{ data: unknown }>;
};
// Inngest's step.run: each step's result is stored by Inngest, so a step returns counts and paths only, never contents.
export type StepRunner = { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> };

export type PushIndexResult =
  | { skipped: "not_linked" | "new_branch" | "too_many_files"; changed?: number }
  | { indexed: number; skippedFiles: number; deleted: number; rlsUnknown: number; ms: number };

/**
 * FEAT-009 job: re-indexes only the files a push to the default branch changed. Contents are fetched through the
 * installation's token, parsed in memory (indexSources) and dropped; only metadata is saved, with the same code as the
 * CLI upload (saveIndexBatch, removeMissing, groupProject). KI-014: the migration sandbox does not run here, so a
 * changed Supabase migration marks the project's tables RLS unknown (fail closed) instead.
 */
export async function runPushIndex(
  db: BrainDb,
  data: PushEventData,
  step: StepRunner,
  github: () => Promise<GithubClient>,
  clock: () => number = Date.now,
): Promise<PushIndexResult> {
  const started = clock();
  const [owner, repo] = data.repo.split("/") as [string, string];

  const linked = await step.run("check-link", () =>
    githubRepo.isLinked(db, data.projectId, data.installationId, data.repo),
  );
  if (!linked) return finish(data, { skipped: "not_linked" }, started, clock);
  // A push that created the branch has no base to compare with; that needs a full index (agent/later.md). Its
  // changes are unknown, so a migration may have changed: RLS fails closed.
  if (data.before === ZERO_SHA) {
    await failClosedOnRls(db, data, step);
    return finish(data, { skipped: "new_branch" }, started, clock);
  }

  const changes = await step.run("list-changes", async () =>
    listChanges(await github(), owner, repo, data),
  );
  if (changes === null) {
    await failClosedOnRls(db, data, step);
    return finish(data, { skipped: "too_many_files" }, started, clock);
  }

  const indexable = changes.changed.filter((p) => pathSkipReason(p) === null);
  let indexed = 0;
  let skippedFiles = changes.changed.length - indexable.length;
  for (let i = 0; i < indexable.length; i += PUSH_BATCH_FILES) {
    const batch = indexable.slice(i, i + PUSH_BATCH_FILES);
    const result = await step.run(`index-batch-${i / PUSH_BATCH_FILES}`, async () =>
      indexBatch(db, await github(), owner, repo, data, batch, changes.removed),
    );
    indexed += result.indexed;
    skippedFiles += result.skipped;
  }

  const deleted = await step.run("remove-deleted", async () => {
    const out = await codeIndexRepo.removeMissing(db, data.projectId, {
      after: null,
      through: null,
      keep: [],
      only: changes.removed,
      final: true,
    });
    return out.deleted.length;
  });

  const rlsUnknown = await step.run("supabase-migrations", async () => {
    const touched = [...changes.changed, ...changes.removed].filter((p) =>
      SUPABASE_MIGRATION.test(p),
    );
    if (touched.length === 0) return 0;
    const n = await dbTablesRepo.markAllRlsUnknown(db, data.projectId);
    console.info(
      "[job]",
      "index-push",
      JSON.stringify({
        projectId: data.projectId,
        migrationsChanged: touched.length,
        rlsUnknown: n,
      }),
    );
    return n;
  });

  await step.run("group-features", () => groupProject(db, data.projectId));
  return finish(data, { indexed, skippedFiles, deleted, rlsUnknown, ms: 0 }, started, clock);
}

// A skipped push may hide a changed migration: every table becomes RLS unknown (build checklist rule 2).
async function failClosedOnRls(db: BrainDb, data: PushEventData, step: StepRunner): Promise<void> {
  await step.run("rls-unknown-on-skip", () => dbTablesRepo.markAllRlsUnknown(db, data.projectId));
}

function finish(
  data: PushEventData,
  result: PushIndexResult,
  started: number,
  clock: () => number,
): PushIndexResult {
  const ms = clock() - started;
  const out = "indexed" in result ? { ...result, ms } : result;
  // AC-009-06: the job's duration is logged (ids and counts only, never paths' contents).
  console.info("[job]", "index-push", JSON.stringify({ projectId: data.projectId, ...out, ms }));
  return out;
}

type Changes = { changed: string[]; removed: string[] };

// Changed and removed paths between the push's before and after (a rename removes the old path). Null above the cap.
async function listChanges(
  gh: GithubClient,
  owner: string,
  repo: string,
  data: PushEventData,
): Promise<Changes | null> {
  const changed = new Set<string>();
  const removed = new Set<string>();
  // Pages stop once the cap is passed, so a huge push costs at most a few compare calls.
  for (let page = 1; page <= Math.floor(MAX_PUSH_FILES / 100) + 1; page++) {
    const res = await gh.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
      owner,
      repo,
      basehead: `${data.before}...${data.after}`,
      per_page: 100,
      page,
    });
    const files = ((res.data as { files?: unknown[] }).files ?? []) as {
      filename: string;
      status: string;
      previous_filename?: string;
    }[];
    for (const f of files) {
      if (f.status === "removed") removed.add(f.filename);
      else changed.add(f.filename);
      if (f.status === "renamed" && f.previous_filename) removed.add(f.previous_filename);
    }
    if (changed.size + removed.size > MAX_PUSH_FILES) return null;
    if (files.length < 100) break;
  }
  for (const p of changed) removed.delete(p);
  return { changed: [...changed], removed: [...removed] };
}

// One step: fetch these files at the push's commit, index them in memory, save metadata. Returns counts only.
async function indexBatch(
  db: BrainDb,
  gh: GithubClient,
  owner: string,
  repo: string,
  data: PushEventData,
  paths: string[],
  removed: string[],
): Promise<{ indexed: number; skipped: number }> {
  const stored = (await filesRepo.list(db, data.projectId)).map((f) => f.path);
  const gone = new Set(removed);
  const knownPaths = [...new Set([...stored, ...paths])].filter((p) => !gone.has(p));
  const tsconfig = await fetchText(gh, owner, repo, "tsconfig.json", data.after);
  const sources: SourceFile[] = [];
  let skipped = 0;
  for (let i = 0; i < paths.length; i += FETCH_CONCURRENCY) {
    const fetched = await Promise.all(
      paths.slice(i, i + FETCH_CONCURRENCY).map((p) => fetchFile(gh, owner, repo, p, data.after)),
    );
    fetched.forEach((content, j) => {
      const path = paths[i + j] as string;
      if (content === null) skipped++;
      else sources.push({ path, content });
    });
  }
  const index = indexSources(sources, { knownPaths, tsconfig });
  // The same validation as the CLI upload route: a path or symbol the schema refuses is skipped, not stored.
  const fileSchema = uploadSchema.shape.files.element;
  const files = toUpload(index).filter((f) => fileSchema.safeParse(f).success);
  skipped += sources.length - files.length;
  if (files.length > 0) await saveIndexBatch(db, data.projectId, { files });
  return { indexed: files.length, skipped };
}

type ContentFile = { type?: string; size?: number; encoding?: string; content?: string };

// The file at a commit as bytes; null when it is missing, not a file, or above the indexer's 1 MB limit (GitHub
// returns no content for those, so nothing large is downloaded).
async function fetchFile(
  gh: GithubClient,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<Uint8Array | null> {
  try {
    const res = await gh.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo,
      path,
      ref,
    });
    const file = res.data as ContentFile;
    if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
      return null;
    }
    if ((file.size ?? 0) > 1024 * 1024) return null;
    return Buffer.from(file.content, "base64");
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

async function fetchText(
  gh: GithubClient,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const bytes = await fetchFile(gh, owner, repo, path, ref);
  return bytes === null ? null : Buffer.from(bytes).toString("utf8");
}
