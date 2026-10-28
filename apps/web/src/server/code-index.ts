import {
  type Llm,
  MAX_ATTEMPTS,
  type PreviousSummaries,
  componentHash,
  componentKey,
  isSummaryDue,
  maskSecretsIn,
  summarizeComponents,
  withPreviousSummaries,
} from "@brain/core";
import {
  type BrainDb,
  type ComponentRow,
  type StorageCaps,
  codeIndexRepo,
  symbolsRepo,
} from "@brain/db";
import { z } from "zod";
import { AppError } from "./errors";
import { nextUtcDay, releaseDaily, reserveDaily } from "./rate-limit";

export const MAX_BATCH_FILES = 200;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
// One summarize request makes at most this many AI calls (~10 calls at a time of 4 = a few seconds); the CLI
// calls again while some are left.
export const SUMMARIZE_MAX_CALLS = 40;
// M2: summarize reads the project's components this many at a time and keeps only the few it will send.
export const SUMMARIZE_PAGE = 1000;
export const INDEX_REQUESTS_PER_MINUTE = 60;
// KI-023: AI calls per project per UTC day; AI_CALLS_PER_PROJECT_PER_DAY overrides it (a positive integer).
export const DEFAULT_AI_CALLS_PER_DAY = 2000;
// M2: stored files and symbols per project; INDEX_MAX_FILES_PER_PROJECT / INDEX_MAX_SYMBOLS_PER_PROJECT override them.
export const DEFAULT_MAX_FILES_PER_PROJECT = 10_000;
export const DEFAULT_MAX_SYMBOLS_PER_PROJECT = 100_000;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : 0;
  return n > 0 ? n : fallback;
}

export function dailyAiBudget(env: Record<string, string | undefined> = process.env): number {
  return positiveInt(env.AI_CALLS_PER_PROJECT_PER_DAY, DEFAULT_AI_CALLS_PER_DAY);
}

export function projectStorageCaps(
  env: Record<string, string | undefined> = process.env,
): StorageCaps {
  return {
    files: positiveInt(env.INDEX_MAX_FILES_PER_PROJECT, DEFAULT_MAX_FILES_PER_PROJECT),
    symbols: positiveInt(env.INDEX_MAX_SYMBOLS_PER_PROJECT, DEFAULT_MAX_SYMBOLS_PER_PROJECT),
  };
}

// Relative POSIX paths inside the repo only: no absolute, drive or backslash paths, no '.', '..' or empty parts, no
// control characters (paths reach agents' context, so no newlines or terminal escapes).
const repoPath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
      !/[\\\u0000-\u001f\u007f]/.test(p) &&
      !/^[A-Za-z]:/.test(p) &&
      p.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    "path must be relative to the repo root",
  );
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "hash must be a sha256 hex digest");

// The upload carries metadata only: there is no field that could hold file contents (unknown keys are rejected).
const symbolSchema = z
  .object({
    kind: z.enum(["component", "route"]),
    name: z.string().min(1).max(500),
    signature: z.string().max(200),
  })
  .strict();
export const uploadSchema = z
  .object({
    files: z
      .array(
        z
          .object({ path: repoPath, hash: sha256, symbols: z.array(symbolSchema).max(500) })
          .strict(),
      )
      .min(1)
      .max(MAX_BATCH_FILES),
  })
  .strict();
// Byte order (UTF-8), the same as Postgres COLLATE "C"; the CLI sorts paths this way for the diff ranges.
export function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

// With `after` and `through` (KI-024) the batch claims to list every local file in the range (after, through]
// (null = open end): files sorted in byte order, no duplicates, all inside the range. Without them nothing is deleted.
// With `folder` (KI-025, a subfolder index) files and range bounds are inside folder/ and only files there are deleted.
export const diffSchema = z
  .object({
    files: z.array(z.object({ path: repoPath, hash: sha256 }).strict()).max(MAX_BATCH_FILES),
    after: repoPath.nullable().optional(),
    through: repoPath.nullable().optional(),
    folder: repoPath.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if ((input.after === undefined) !== (input.through === undefined)) {
      ctx.addIssue({ code: "custom", message: "after and through come together", path: ["after"] });
      return;
    }
    if (input.after === undefined) {
      if (input.folder !== undefined)
        ctx.addIssue({ code: "custom", message: "folder needs a range", path: ["folder"] });
      if (input.files.length === 0)
        ctx.addIssue({ code: "custom", message: "at least one file", path: ["files"] });
      return;
    }
    const { after, through } = input;
    if (after != null && through != null && byteOrder(after, through) >= 0)
      ctx.addIssue({ code: "custom", message: "after must sort before through", path: ["after"] });
    const inFolder = (p: string) => input.folder === undefined || p.startsWith(`${input.folder}/`);
    if ((after != null && !inFolder(after)) || (through != null && !inFolder(through)))
      ctx.addIssue({ code: "custom", message: "range must be inside folder", path: ["folder"] });
    input.files.forEach((f, i) => {
      const prev = input.files[i - 1];
      const ok =
        (prev ? byteOrder(prev.path, f.path) < 0 : true) &&
        (after == null || byteOrder(after, f.path) < 0) &&
        (through == null || byteOrder(f.path, through) <= 0) &&
        inFolder(f.path);
      if (!ok)
        ctx.addIssue({
          code: "custom",
          message: "files must be unique, in byte order and inside (after, through] and folder",
          path: ["files", i, "path"],
        });
    });
  });

async function readLimited(req: Request, max: number): Promise<string> {
  if (Number(req.headers.get("content-length") ?? 0) > max) throw tooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function tooLarge(): AppError {
  return new AppError(
    413,
    "payload_too_large",
    `at most ${MAX_BATCH_FILES} files and ${MAX_BODY_BYTES / 1024 / 1024} MB per batch`,
  );
}

// Size limits answer 413 before validation; everything else invalid is a 400 from the schema.
export async function parseIndexBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await readLimited(req, MAX_BODY_BYTES);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError(400, "invalid_json", "request body is not valid JSON");
  }
  const files = (raw as { files?: unknown } | null)?.files;
  if (Array.isArray(files) && files.length > MAX_BATCH_FILES) throw tooLarge();
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues)
      fieldErrors[issue.path.join(".") || "_"] = issue.message;
    throw new AppError(400, "invalid_input", "input validation failed", fieldErrors);
  }
  return result.data;
}

/**
 * changed: paths whose stored hash differs or that are not stored yet, in request order. deleted (KI-024, only with a
 * range): stored paths in the range that the request does not list; they are removed with their symbols.
 */
export async function diffFiles(
  db: BrainDb,
  projectId: string,
  input: z.infer<typeof diffSchema>,
): Promise<{ changed: string[]; deleted: string[] }> {
  const paths = input.files.map((f) => f.path);
  const stored = await codeIndexRepo.hashes(db, projectId, paths);
  const changed = input.files.filter((f) => stored.get(f.path) !== f.hash).map((f) => f.path);
  if (input.after === undefined || input.through === undefined) return { changed, deleted: [] };
  const deleted = await codeIndexRepo.removeMissing(db, projectId, {
    after: input.after,
    through: input.through,
    folder: input.folder ?? null,
    keep: paths,
  });
  return { changed, deleted };
}

function asPrevious(rows: ComponentRow[]): PreviousSummaries {
  return new Map(rows.map((r) => [componentKey(r.path, r.name), r]));
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

export type SummarizeResult = {
  attempted: number;
  remaining: number;
  enabled: boolean;
  // KI-023: the project's daily AI budget is used up; the rest waits until resumesAt (next UTC midnight).
  budgetExhausted: boolean;
  resumesAt: string | null;
};

const asInput = (r: ComponentRow) => ({
  id: r.id,
  path: r.path,
  name: r.name,
  signature: r.signature ?? "",
});

// Summarizes the project's due components, at most SUMMARIZE_MAX_CALLS per request and within the project's daily AI
// budget (KI-023). The previous summaries and attempt state come from the database (KI-022) and every attempt is
// stamped with the server's clock. M2: components are read in pages; only the due ones this request can send (and as
// many that used up their attempts, for the final attempt after a success) are kept, the rest are only counted.
export async function summarizeDue(
  db: BrainDb,
  projectId: string,
  llm: Llm | null,
  pageSize = SUMMARIZE_PAGE,
): Promise<SummarizeResult> {
  const now = new Date();
  const picked: ComponentRow[] = [];
  let dueTotal = 0;
  let pickedDue = 0;
  let pickedExhausted = 0;
  for (let afterId: string | undefined; ; ) {
    const page = await symbolsRepo.listComponents(db, projectId, { afterId, limit: pageSize });
    for (const row of page) {
      const [c] = withPreviousSummaries([asInput(row)], asPrevious([row]));
      if (!c) continue;
      if (isSummaryDue(c, now)) {
        dueTotal++;
        if (pickedDue < SUMMARIZE_MAX_CALLS) {
          picked.push(row);
          pickedDue++;
        }
      } else if (
        c.summaryStatus === "error" &&
        c.summaryAttempts === MAX_ATTEMPTS &&
        pickedExhausted < SUMMARIZE_MAX_CALLS
      ) {
        picked.push(row);
        pickedExhausted++;
      }
    }
    if (page.length < pageSize) break;
    afterId = page.at(-1)?.id;
  }
  const result = (attempted: number, remaining: number, exhausted: boolean) => ({
    attempted,
    remaining,
    enabled: llm !== null,
    budgetExhausted: exhausted,
    resumesAt: exhausted ? nextUtcDay(now).toISOString() : null,
  });
  if (!llm || dueTotal === 0) return result(0, dueTotal, false);

  // Reserve calls before making them; whatever is not used goes back to the budget.
  const key = `ai:${projectId}`;
  const want = Math.min(SUMMARIZE_MAX_CALLS, dueTotal);
  const granted = await reserveDaily(db, key, dailyAiBudget(), want, now);
  let used = 0;
  try {
    if (granted === 0) return result(0, dueTotal, true);
    const out = await summarizeComponents(picked.map(asInput), llm, asPrevious(picked), {
      now,
      maxCalls: granted,
    });
    const attempted = out.filter((c) => c.summaryAttemptedAt === now);
    used = attempted.length;
    await codeIndexRepo.saveSummaries(db, projectId, attempted);
    const remaining = dueTotal - pickedDue + out.filter((c) => isSummaryDue(c, now)).length;
    return result(used, remaining, remaining > 0 && granted < want && used === granted);
  } finally {
    await releaseDaily(db, key, want - used, now);
  }
}
