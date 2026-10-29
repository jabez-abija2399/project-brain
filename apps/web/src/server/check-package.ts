import {
  type AddedDependency,
  type PackageCheck,
  addedDependencies,
  isValidPackageName,
  isValidVersion,
  maskSecretsIn,
  oneLineText,
} from "@brain/core";
import type { BrainDb } from "@brain/db";
import { z } from "zod";
import { repoPath } from "./code-index-input";
import { AppError } from "./errors";
import { lookupPackage } from "./npm-registry";
import { MCP_CALLS_PER_MINUTE, rateLimit } from "./rate-limit";
import { type ToolToken, bindToken } from "./session-tools";

// package.json files per receipt, characters per file, and new dependencies checked per receipt.
export const MAX_PACKAGE_JSON_FILES = 10;
export const MAX_PACKAGE_JSON_CHARS = 256_000;
export const MAX_NEW_DEPENDENCIES = 20;
const CONCURRENCY = 5;

const id = z.string().min(1).max(100);
const checkSchema = z
  .object({
    projectId: id,
    name: z
      .string()
      .max(214, "must be 214 characters or fewer")
      .refine(isValidPackageName, "is not a valid npm package name"),
    version: z.string().refine(isValidVersion, "must be an exact version like 1.2.3").optional(),
  })
  .strict();

export const packageJsonChanges = z
  .array(
    z
      .object({
        path: repoPath,
        before: z.string().max(MAX_PACKAGE_JSON_CHARS).nullable().optional(),
        after: z.string().max(MAX_PACKAGE_JSON_CHARS),
      })
      .strict(),
  )
  .max(MAX_PACKAGE_JSON_FILES, `at most ${MAX_PACKAGE_JSON_FILES} package.json files per receipt`);

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) fieldErrors[issue.path.join(".") || "_"] = issue.message;
  throw new AppError(400, "invalid_input", "input validation failed", fieldErrors);
}

async function countChecks(db: BrainDb, token: ToolToken, n: number, now: Date) {
  if (n <= 0) return;
  await rateLimit(db, `mcp:${token.id}`, MCP_CALLS_PER_MINUTE, now, n);
  await rateLimit(db, `mcp-project:${token.projectId}`, MCP_CALLS_PER_MINUTE, now, n);
}

/**
 * MCP check_package (FEAT-014): exists / risky / not found / unreachable for one npm name, with age, last release,
 * repository link and the release cooldown for the latest (or given) version. The name is validated before any
 * request, so it cannot change the URL. Counted by the MCP route's per-minute limits like every tool call.
 */
export async function checkPackage(
  token: ToolToken,
  raw: unknown,
  now = new Date(),
): Promise<PackageCheck> {
  const input = parse(checkSchema, raw);
  bindToken(token, input.projectId);
  return lookupPackage(input.name, input.version ?? null, now);
}

export type NewDependency = {
  name: string;
  range: string;
  path: string;
  check: PackageCheck | null;
  note?: string;
};

const shown = (value: string) => maskSecretsIn(oneLineText(value)).slice(0, 214);
// New dependencies listed per receipt; the rest are only counted (new_dependencies_omitted).
export const MAX_LISTED_DEPENDENCIES = 200;

export type PreparedDependencies = {
  found: { entry: NewDependency; target: string | null; version: string | null }[];
  omitted: number;
};

/**
 * First half of the receipt's dependency list (AC-014-05): parses the package.json changes, finds every added or
 * re-pointed dependency and counts the registry checks against the per-minute limits. Runs before any AI call, so
 * bad input or a full limit costs no AI budget. Only names, ranges and results are kept; the package.json text is
 * neither stored nor logged.
 */
export async function prepareNewDependencies(
  db: BrainDb,
  token: ToolToken,
  changes: z.infer<typeof packageJsonChanges>,
  now = new Date(),
): Promise<PreparedDependencies> {
  const found: PreparedDependencies["found"] = [];
  const seen = new Set<string>();
  let omitted = 0;
  let checks = 0;
  changes.forEach((change, i) => {
    let added: AddedDependency[];
    try {
      added = addedDependencies(change.before ?? null, change.after);
    } catch {
      throw new AppError(400, "invalid_input", "input validation failed", {
        [`packageJson.${i}`]: "before and after must be package.json text (a JSON object)",
      });
    }
    for (const dep of added) {
      if (seen.has(dep.name)) continue;
      seen.add(dep.name);
      if (found.length >= MAX_LISTED_DEPENDENCIES) {
        omitted++;
        continue;
      }
      const entry: NewDependency = {
        name: shown(dep.name),
        range: dep.range,
        path: change.path,
        check: null,
      };
      let target: string | null = null;
      if (!isValidPackageName(dep.name)) entry.note = "not a valid npm package name";
      else if (dep.target === null)
        entry.note = "not from the npm registry (git, file, link or workspace)";
      else if (!isValidPackageName(dep.target))
        entry.note = "alias target is not a valid npm package name";
      // A secret-shaped name is never sent to npm in a URL.
      else if (maskSecretsIn(dep.target) !== dep.target)
        entry.note = "not checked: the name looks like a secret";
      else if (checks >= MAX_NEW_DEPENDENCIES) {
        entry.note = "not checked: too many new dependencies in one receipt";
      } else {
        target = dep.target;
        checks++;
      }
      found.push({ entry, target, version: target ? dep.version : null });
    }
  });
  await countChecks(db, token, checks, now);
  return { found, omitted };
}

/** Second half: the check_package result for each prepared dependency (at most CONCURRENCY at a time). */
export async function lookupNewDependencies(
  prepared: PreparedDependencies,
  now = new Date(),
): Promise<NewDependency[]> {
  const todo = prepared.found.filter((f) => f.target !== null);
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(
      todo.slice(i, i + CONCURRENCY).map(async (t) => {
        t.entry.check = await lookupPackage(t.target as string, t.version, now);
      }),
    );
  }
  return prepared.found.map((f) => f.entry);
}
