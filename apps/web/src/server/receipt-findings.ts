import { type Finding, SECRET_TYPES, rlsFindings, secretFinding } from "@brain/core";
import { type BrainDb, dbSchemaRepo } from "@brain/db";
import { z } from "zod";
import { repoPath } from "./code-index-input";

// Findings listed per receipt; the rest are only counted (findings_omitted).
export const MAX_FINDINGS = 200;
export const MAX_SECRET_FINDINGS = 200;

// The CLI's `projectbrain scan-secrets` output (FEAT-015): masked findings only. A value that is not the first 4
// characters + *** is refused (400) and never stored, logged or echoed (AC-015-03).
export const secretFindingsInput = z
  .array(
    z
      .object({
        file: repoPath,
        line: z.number().int().min(1).max(10_000_000),
        type: z.enum(SECRET_TYPES),
        masked_value: z
          .string()
          .regex(/^[\x21-\x7e]{1,4}\*\*\*$/, "must be masked: the first 4 characters + ***"),
      })
      .strict(),
  )
  .max(MAX_SECRET_FINDINGS, `at most ${MAX_SECRET_FINDINGS} secret findings per receipt`);

/**
 * Security findings for a receipt: the secrets the CLI found in the changed files, then RLS problems from the stored
 * flags of the last index (AC-015-04/06/07). Capped at MAX_FINDINGS, with half the room kept for each kind so many
 * secrets cannot push every RLS finding out; the rest are counted (with the CLI's own omitted count), never dropped
 * silently.
 */
export async function receiptFindings(
  db: BrainDb,
  projectId: string,
  secrets: z.infer<typeof secretFindingsInput>,
  secretsOmitted = 0,
): Promise<{ findings: Finding[]; findings_omitted: number; rls_tables_checked: number }> {
  const tables = await dbSchemaRepo.listWithPolicies(db, projectId);
  const rls = rlsFindings(tables);
  const secretRoom = Math.max(MAX_FINDINGS / 2, MAX_FINDINGS - rls.length);
  const shownSecrets = secrets.slice(0, secretRoom).map(secretFinding);
  const shownRls = rls.slice(0, MAX_FINDINGS - shownSecrets.length);
  return {
    findings: [...shownSecrets, ...shownRls],
    findings_omitted:
      secretsOmitted + secrets.length - shownSecrets.length + rls.length - shownRls.length,
    rls_tables_checked: tables.length,
  };
}
