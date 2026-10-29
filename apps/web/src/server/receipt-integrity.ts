import { maskPath, safeDisplay } from "@brain/core";
import { z } from "zod";
import { repoPath } from "./code-index-input";

// FEAT-018: what the session-end hook found on the user's machine: file names, test names and counts only (D-002).
export const MAX_INTEGRITY_FLAGS = 50;
const MAX_NAMES = 20;

const KINDS = [
  "deleted_test_file",
  "deleted_tests",
  "skipped_tests",
  "removed_assertions",
  "test_config_changed",
] as const;
const count = z.number().int().min(0).max(1_000_000);

export const testIntegrityInput = z
  .object({
    flags: z
      .array(
        z
          .object({
            kind: z.enum(KINDS),
            file: repoPath,
            names: z.array(z.string().max(500)).max(MAX_NAMES),
            count,
          })
          .strict(),
      )
      .max(MAX_INTEGRITY_FLAGS),
    passingBefore: count.nullable().optional(),
    passingAfter: count.nullable().optional(),
  })
  .strict();

export type TestIntegrity = {
  flags: { kind: string; file: string; names: string[]; count: number }[];
  passing_before: number | null;
  passing_after: number | null;
};

/**
 * The receipt's test_integrity section: the hook's flags, cleaned and masked, plus the passing-test counts; a drop in
 * passing tests is a flag of its own (AC-018-05). Null when the hook sent nothing.
 */
export function testIntegrity(
  input: z.infer<typeof testIntegrityInput> | undefined,
): TestIntegrity | null {
  if (!input) return null;
  const before = input.passingBefore ?? null;
  const after = input.passingAfter ?? null;
  const flags: TestIntegrity["flags"] = input.flags.map((f) => ({
    kind: f.kind,
    file: maskPath(f.file),
    names: f.names.map((n) => safeDisplay(n, 200)).filter(Boolean),
    count: f.count,
  }));
  if (before !== null && after !== null && after < before) {
    flags.push({ kind: "passing_tests_dropped", file: "", names: [], count: before - after });
  }
  return { flags, passing_before: before, passing_after: after };
}
