// Phase 3a: whole-Blueprint checks. Warnings only: nothing here blocks a save.
import { type Flag, ambiguityFlags } from "./ambiguity";
import { type Contradiction, contradictions } from "./contradictions";
import { type Ears, parseEars } from "./ears";

export type CriterionKind = "behaviour" | "must_never" | "security";

// A criterion counts unless it has been retired.
const RETIRED = new Set(["removed", "archived", "superseded", "dropped", "rejected", "deleted"]);
const isActive = (status: string) => !RETIRED.has(status.trim().toLowerCase());

export type CoverageWarning = { featureId: string; message: string };

/** Features with no active must-never or security criterion: nothing says what the feature must not allow. */
export function mustNeverCoverage(
  features: { id: string; criteria: { kind: CriterionKind; status: string }[] }[],
): CoverageWarning[] {
  return features
    .filter((f) => !f.criteria.some((c) => c.kind !== "behaviour" && isActive(c.status)))
    .map((f) => ({
      featureId: f.id,
      message:
        "This feature has no 'must never' or security rule, so nothing says what it must not allow.",
    }));
}

export type BlueprintCheck = {
  featureId: string;
  criteria: { id: string; ears: Ears | null; flags: Flag[] }[];
  contradictions: Contradiction[];
  coverage: CoverageWarning | null;
};

/** Ambiguity flags per criterion, contradictions among active criteria and the coverage warning, per feature. */
export function checkBlueprint(input: {
  features: {
    id: string;
    criteria: { id: string; text: string; kind: CriterionKind; status: string }[];
  }[];
}): BlueprintCheck[] {
  const coverage = new Map(mustNeverCoverage(input.features).map((w) => [w.featureId, w]));
  return input.features.map((feature) => {
    const criteria = feature.criteria.map((c) => {
      const ears = parseEars(c.text);
      return { id: c.id, ears, flags: ambiguityFlags(c.text, ears), active: isActive(c.status) };
    });
    const parsed = criteria.flatMap((c) =>
      c.ears && c.active ? [{ id: c.id, ears: c.ears }] : [],
    );
    return {
      featureId: feature.id,
      criteria: criteria.map(({ id, ears, flags }) => ({ id, ears, flags })),
      contradictions: contradictions(parsed),
      coverage: coverage.get(feature.id) ?? null,
    };
  });
}
