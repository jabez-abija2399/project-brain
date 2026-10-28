import { z } from "zod";
import { MAX_BATCH_FILES, MAX_BODY_BYTES } from "./code-index-limits";
import { AppError } from "./errors";

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
    final: z.literal(true).optional(),
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
      if (input.final !== undefined)
        ctx.addIssue({ code: "custom", message: "final needs a range", path: ["final"] });
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
