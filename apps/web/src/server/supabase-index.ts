import { type BrainDb, dbSchemaRepo } from "@brain/db";
import { z } from "zod";
import { repoPath } from "./code-index-input";

// FEAT-015: the CLI reads supabase/migrations with the sandbox on the user's machine (the server never runs it,
// KI-014) and uploads flags only: no SQL text (AC-005-05). Same caps as the sandbox (5,000 tables and policies).
export const MAX_DB_TABLES = 5_000;
export const MAX_DB_POLICIES = 5_000;

// A Postgres identifier as the reader reports it: up to 63 bytes, quoted names may hold any printable character.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^\u0000-\u001f\u007f-\u009f]+$/, "invalid name");

const table = z
  .object({
    schema: identifier,
    name: identifier,
    path: repoPath,
    rlsEnabled: z.boolean(),
    rlsUnknown: z.boolean(),
  })
  .strict()
  .refine((t) => !(t.rlsEnabled && t.rlsUnknown), "rlsEnabled and rlsUnknown cannot both be true");

const policy = z
  .object({
    schema: identifier,
    table: identifier,
    command: z.enum(["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"]),
    permissive: z.boolean(),
    allowsAll: z.boolean(),
    checksOwnership: z.boolean(),
  })
  .strict()
  // A restrictive policy never allows everyone (AC-015-07).
  .refine((p) => p.permissive || !p.allowsAll, "a restrictive policy cannot allow all");

export const supabaseFlagsSchema = z
  .object({
    tables: z.array(table).max(MAX_DB_TABLES, `at most ${MAX_DB_TABLES} tables`),
    policies: z.array(policy).max(MAX_DB_POLICIES, `at most ${MAX_DB_POLICIES} policies`),
  })
  .strict()
  .refine(
    (b) => new Set(b.tables.map((t) => `${t.schema}.${t.name}`)).size === b.tables.length,
    "each table may be listed once",
  );

/** Replaces the project's stored RLS flags with this upload (the latest index wins). */
export async function saveSupabaseFlags(
  db: BrainDb,
  projectId: string,
  body: z.infer<typeof supabaseFlagsSchema>,
) {
  return dbSchemaRepo.replaceForProject(db, projectId, body.tables, body.policies);
}
