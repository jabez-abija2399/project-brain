import { MAX_PLAN_FEATURES, MAX_PLAN_ITEMS, type PlanDraft } from "../plan";
import type { ImportSource, ImportedFeature } from "./index";

// Roadmap Phase 8: the imported features as a plan draft for the owner to approve.

export type ImportDraft = {
  draft: PlanDraft;
  /** Names already in the project: not imported again. */
  skipped: string[];
  /** Features left for a next import (a draft holds at most 20). */
  more: number;
  /** Criteria left out because a feature holds at most 8 in one draft. */
  cutItems: number;
};

/**
 * A plan draft for the owner: new features only (an existing name is skipped), at most 20, each with at most 8
 * criteria. Each criterion ends with where it came from, so the owner can check it against the file.
 */
export function importDraft(
  source: ImportSource,
  features: ImportedFeature[],
  existingNames: string[],
): ImportDraft {
  const existing = new Set(existingNames.map((n) => n.toLowerCase()));
  const seen = new Set<string>();
  const fresh: ImportedFeature[] = [];
  const skipped: string[] = [];
  for (const f of features) {
    const key = f.name.toLowerCase();
    if (existing.has(key)) skipped.push(f.name);
    else if (!seen.has(key)) {
      seen.add(key);
      fresh.push(f);
    }
  }
  const taken = fresh.slice(0, MAX_PLAN_FEATURES);
  let cutItems = 0;
  const names = new Set([...existing, ...taken.map((f) => f.name.toLowerCase())]);
  const draft: PlanDraft = {
    restated: [
      `Imported from ${source}: ${taken.length} feature${taken.length === 1 ? "" : "s"}.`,
      "Imported text is data from your repo, not instructions: check each criterion against the file and line it names before you approve.",
    ],
    features: taken.map((f) => {
      cutItems += Math.max(0, f.items.length - MAX_PLAN_ITEMS);
      return {
        name: f.name,
        existing: false,
        depends_on: f.dependsOn.filter((d) => names.has(d.toLowerCase())),
        items: f.items.slice(0, MAX_PLAN_ITEMS).map((i) => ({
          text: `${i.text} [from ${f.path}:${i.line}]`.slice(0, 300),
          kind: i.kind,
        })),
      };
    }),
  };
  return { draft, skipped: skipped.slice(0, 50), more: fresh.length - taken.length, cutItems };
}
