// Roadmap Phase 5 (Codeceipt Guard): the Blueprint's active, owner-approved boundaries for this project, read by the
// CLI's guard (and later its pre-tool-use hook) with a project token. Proposals, other projects' boundaries and anything
// before migration 0054 are never returned. Kinds and patterns only; the owner wrote the patterns.
import { boundariesRepo } from "@brain/db";
import type { BrainDb } from "@brain/db";
import { blueprintEnabled } from "./migration-check";

const MAX_BOUNDARIES = 500;
const MAX_PATTERN = 300;
const KINDS = new Set(["protected_path", "disallowed_dependency", "allowed_dependency"]);

export async function hookBoundaries(
  db: BrainDb,
  projectId: string,
): Promise<{ ready: boolean; boundaries: { kind: string; pattern: string }[] }> {
  if (!(await blueprintEnabled(db))) return { ready: false, boundaries: [] };
  const rows = await boundariesRepo.active(db, projectId, MAX_BOUNDARIES);
  return {
    ready: true,
    boundaries: rows
      .filter((b) => KINDS.has(b.kind) && b.pattern.length <= MAX_PATTERN)
      .map((b) => ({ kind: b.kind, pattern: b.pattern })),
  };
}
