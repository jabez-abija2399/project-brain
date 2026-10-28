import {
  type Llm,
  type PreviousSummaries,
  componentHash,
  componentKey,
  isSummaryDue,
  maskSecretsIn,
  summarizeComponents,
  withPreviousSummaries,
} from "@brain/core";
import { type BrainDb, type ComponentRow, codeIndexRepo, symbolsRepo } from "@brain/db";
import { z } from "zod";
import { AppError } from "./errors";

export const MAX_BATCH_FILES = 200;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
// One summarize request makes at most this many AI calls (~10 calls at a time of 4 = a few seconds); the CLI
// calls again while some are left.
export const SUMMARIZE_MAX_CALLS = 40;
export const INDEX_REQUESTS_PER_MINUTE = 60;

// Relative POSIX paths inside the repo only: no absolute, drive or backslash paths, no '.', '..' or empty parts.
const repoPath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !/[\\\0]/.test(p) &&
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
export const diffSchema = z
  .object({
    files: z
      .array(z.object({ path: repoPath, hash: sha256 }).strict())
      .min(1)
      .max(MAX_BATCH_FILES),
  })
  .strict();

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

/** Paths whose stored hash differs or that are not stored yet, in request order. */
export async function diffFiles(
  db: BrainDb,
  projectId: string,
  input: z.infer<typeof diffSchema>,
): Promise<string[]> {
  const stored = await codeIndexRepo.hashes(
    db,
    projectId,
    input.files.map((f) => f.path),
  );
  return input.files.filter((f) => stored.get(f.path) !== f.hash).map((f) => f.path);
}

function asPrevious(rows: ComponentRow[]): PreviousSummaries {
  return new Map(rows.map((r) => [componentKey(r.path, r.name), r]));
}

// Replaces the batch's files and symbols. Components whose summary inputs did not change keep their summary and
// attempt state (KI-022), so a re-upload never causes a new AI call for them.
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
        .map((s) => ({ path: f.path, name: s.name, signature: maskSecretsIn(s.signature) })),
      previous,
    );
    const routes = f.symbols
      .filter((s) => s.kind === "route")
      .map((s) => ({
        kind: "route",
        name: maskSecretsIn(s.name),
        signature: s.signature,
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
  await codeIndexRepo.saveFiles(db, projectId, files);
}

export type SummarizeResult = { attempted: number; remaining: number; enabled: boolean };

// Summarizes the project's due components, at most SUMMARIZE_MAX_CALLS per request. The previous summaries and
// attempt state come from the database (KI-022) and every attempt is stamped with the server's clock.
export async function summarizeDue(
  db: BrainDb,
  projectId: string,
  llm: Llm | null,
): Promise<SummarizeResult> {
  const now = new Date();
  const rows = await symbolsRepo.listComponents(db, projectId);
  const inputs = rows.map((r) => ({
    id: r.id,
    path: r.path,
    name: r.name,
    signature: r.signature ?? "",
  }));
  if (!llm) {
    const due = withPreviousSummaries(inputs, asPrevious(rows)).filter((c) => isSummaryDue(c, now));
    return { attempted: 0, remaining: due.length, enabled: false };
  }
  const out = await summarizeComponents(inputs, llm, asPrevious(rows), {
    now,
    maxCalls: SUMMARIZE_MAX_CALLS,
  });
  const attempted = out.filter((c) => c.summaryAttemptedAt === now);
  await codeIndexRepo.saveSummaries(db, projectId, attempted);
  return {
    attempted: attempted.length,
    remaining: out.filter((c) => isSummaryDue(c, now)).length,
    enabled: true,
  };
}
