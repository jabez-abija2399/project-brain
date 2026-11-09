// Phase 3a: Blueprint core (EARS criteria, ambiguity flags, contradictions, coverage, proof, snapshots). Pure.
export {
  type Ears,
  type EarsForm,
  MAX_CRITERION_CHARS,
  formatEars,
  parseEars,
  plainSentence,
} from "./ears";
export { type Flag, type FlagCode, ambiguityFlags } from "./ambiguity";
export { type Contradiction, contradictions, subjectKey } from "./contradictions";
export {
  type BlueprintCheck,
  type CoverageWarning,
  type CriterionKind,
  checkBlueprint,
  mustNeverCoverage,
} from "./coverage";
export { type Proof, proofStatus } from "./proof";
export {
  BLUEPRINT_SNAPSHOT_VERSION,
  type BlueprintSnapshot,
  type BoundaryKind,
  SNAPSHOT_LIMITS,
  type SnapshotCriterion,
  type SnapshotDiff,
  type SnapshotFeature,
  type SnapshotInput,
  buildSnapshot,
  diffSnapshots,
  parseSnapshot,
  snapshotHash,
} from "./snapshot";
export { MAX_REWRITE_ITEMS, REWRITE_SYSTEM, rewritePrompt, suggestRewrites } from "./rewrite-llm";
export {
  DISCOVER_LIST_MAX,
  type DiscoverInput,
  type DiscoveredFeature,
  type Suggestion,
  discoverBlueprint,
  groupBy,
} from "./discover";
export { MAX_RISKS, type Risk, type RiskKind, type SafetyInput, safetyCheck } from "./safety";
export {
  type BoundaryHit,
  type BoundaryHitKind,
  MAX_BOUNDARY_HITS,
  checkBoundaries,
  globMatch,
} from "./boundary-check";
