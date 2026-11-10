export const PACKAGE = "@brain/core";
export const VERSION = "0.0.0";

// The indexer (typescript, ignore) is imported from "@brain/core/indexer", never from this barrel: anything that imports
// the barrel (every CLI hook) must not load typescript at start-up (roadmap Phase 2b, docs/performance.md).
export type { SourceFile } from "./indexer";
export { toUpload } from "./upload";
export {
  CHECKLIST_SYSTEM,
  MAX_CHECKLIST_ITEMS,
  MAX_ITEM_CHARS,
  MAX_REQUEST_CHARS,
  checklistPrompt,
  parseChecklist,
  splitRequest,
  type ChecklistDraftItem,
} from "./checklist";
export type { UploadFile, UploadSymbol } from "./upload";
export type {
  ComponentIndex,
  FileIndex,
  ImportIndex,
  IndexError,
  IndexOptions,
  IndexResult,
  RouteIndex,
  SkippedFile,
} from "./indexer";

export {
  FALLBACK_FEATURE,
  ROOT_FEATURE,
  SHARED_MIN_FEATURES,
  TESTS_KEY,
  featureFromPath,
  groupFeatures,
  testSubjects,
} from "./features";
export type { FeatureGroup, FeatureMap, RouteInput, SharedFile } from "./features";

export {
  DEFAULT_SIMILAR_LIMIT,
  MAX_ATTEMPTS,
  MAX_SUMMARY,
  SIMILARITY_THRESHOLD,
  componentHash,
  componentKey,
  findSimilarComponent,
  isSummaryDue,
  similarNameFilter,
  summarizeComponents,
  withPreviousSummaries,
} from "./components";
export type {
  PreviousSummaries,
  Summarized,
  SummaryInput,
  SimilarCandidate,
  SimilarMatch,
  SimilarOptions,
  SummarizedComponent,
  SummaryState,
  SummaryStatus,
} from "./components";
export { DEFAULT_MODEL, MAX_TOKENS_CEILING, createLlm, errorType } from "./llm";
export type { CompleteRequest, Llm, LlmClient, LlmCostEntry, LlmOptions } from "./llm";

export { maskPath, maskSecret, maskSecretsIn } from "./mask";
export { oneLineText, plainText } from "./text";
export { checkTestIntegrity, isTestConfig, isTestFile } from "./test-integrity";
export type { FileChange, IntegrityFlag, IntegrityKind } from "./test-integrity";
export { fixPrompt, itemIdsOf, receiptView, safeDisplay, safePath } from "./fix-prompt";
export { MAX_REVIEW_PLACES, type ReviewPlace, reviewFirst } from "./review-first";
export type { ReceiptItemStatus, ReceiptView } from "./fix-prompt";
export { isLocalEnvFile, MAX_SCAN_BYTES, scanSecrets, SECRET_TYPES } from "./secrets";
export type { SecretFinding, SecretType } from "./secrets";
export { rlsFindings, secretFinding } from "./receipt-findings";
export type { Finding, FindingType, StoredTable } from "./receipt-findings";
export {
  addedDependencies,
  changedDependencies,
  assessPackage,
  isValidPackageName,
  isValidVersion,
  KNOWN_HALLUCINATED,
  RELEASE_COOLDOWN_DAYS,
  summarizePackument,
} from "./package-check";
export type { AddedDependency, PackageCheck, RegistryAnswer } from "./package-check";
export {
  MAX_SUMMARY_SYMBOLS,
  type ChangeSummary,
  describeChange,
  summarizeDiff,
  skippedFile,
  summarizeNewFile,
} from "./change-summary";
export {
  NOT_ENOUGH_EVIDENCE,
  NO_REQUEST_NOTE,
  NO_SNAPSHOT_NOTE,
  RECEIPT_SYSTEM,
  buildReceipt,
  groupFiles,
  parseVerdicts,
  receiptPrompt,
  type Receipt,
  type ReceiptFileInput,
  type ReceiptItem,
  type ReceiptItemInput,
} from "./receipt";
export {
  DIRECTIVE_BUDGET,
  HANDOFF_LIMIT,
  buildHandoffNote,
  type HandoffInput,
} from "./handoff";
// The Supabase migration reader (libpg-query) runs only in the CLI: import it from "@brain/core/supabase", so the web
// server bundle never loads it.
export type {
  ColumnDecl,
  MigrationSandbox,
  PolicyCommand,
  PolicyKey,
  PolicySchema,
  PolicyTrees,
  SandboxPolicy,
  SandboxRun,
  SandboxStatement,
  SandboxStep,
  SandboxTable,
  SupabaseReadError,
  SupabaseReadResult,
  PolicyFlags,
  TableFlags,
  TableSchema,
} from "./supabase";
export {
  ITEM_KINDS,
  MAX_ANSWER_CHARS,
  MAX_IDEA_CHARS,
  PlanRejectedError,
  checkDraft,
  draftHash,
  parseStage1,
  planKindToCriterion,
  planStage1,
  planStage2,
} from "./plan";
export type { PlanDraft, PlanFeature, PlanItem, PlanQuestion, PlanStage1 } from "./plan";
export {
  CLI_NAME,
  LEGACY_CLI_NAME,
  LEGACY_PRODUCT_NAME,
  PRODUCT_NAME,
  TAGLINE,
  brandEnv,
} from "./brand";
export { isCodeceiptSetupPath, withoutAgentsSection } from "./setup-files";
export {
  CAPTURE_SYSTEM,
  type Captured,
  capturePrompt,
  classifyRequest,
  isAcknowledgement,
  MAX_STORED_REQUEST_CHARS,
  parseCapture,
  requestForStorage,
} from "./request-capture";
export {
  attentionReasons,
  overviewStats,
  receiptNeedsAttention,
  type OverviewRow,
  type OverviewStats,
} from "./overview";
export {
  type RepoFingerprint,
  fingerprintOf,
  fingerprintToken,
  mergeFingerprints,
  normalizeRemote,
  parseFingerprintToken,
  sameRepo,
  tokenFromHashed,
} from "./repo-fingerprint";
export { askedForCheck, askedForFile, namesFile } from "./asked-for";

// Phase 3a: Blueprint core (EARS criteria, ambiguity flags, contradictions, coverage, proof, snapshots; pure).
export * from "./blueprint";

// H1/H2 (2026-11-02): near-duplicate checklist items and the one-time open-items cleanup plan (pure).
export {
  DUPLICATE_SIMILARITY,
  findNearDuplicate,
  isNearDuplicate,
  itemKey,
  itemSimilarity,
  planOpenItemCleanup,
  type CleanupChange,
  type CleanupItem,
} from "./item-dedup";
export {
  FOUNDING,
  PLANS,
  type Plan,
  type PlanId,
  effectivePlan,
  isPlanId,
  monthStart,
} from "./plans";
// Roadmap Phase 5: Codeceipt Guard (checks a change before it is committed or merged).
export { guardCheck, MAX_GUARD_FINDINGS, newLines, newPackageNames } from "./guard";
export type { GuardFile, GuardFinding, GuardInput, GuardRule } from "./guard";
export { findHiddenChars } from "./hidden-chars";
export {
  EXPORT_TARGETS,
  GENERATED_MARK,
  SECTION_END,
  SECTION_START,
  agentsSection,
  isGenerated,
  mergeAgents,
  specFiles,
} from "./export";
export type { ExportBlueprint, ExportTarget } from "./export";
export {
  IMPORT_SOURCES,
  MAX_IMPORT_FILE_CHARS,
  MAX_IMPORT_FILES,
  importDraft,
  importFeatures,
  importPathMatches,
} from "./import";
export type {
  ImportDraft,
  ImportFile,
  ImportSource,
  ImportedFeature,
  ImportedItem,
} from "./import";
export {
  LARGE_CHANGE_LINES,
  LONG_FILE_LINES,
  MANY_FILES,
  REVIEW_RULES,
  maintainabilityFlags,
  reviewChecklist,
} from "./review-checklist";
export type {
  MaintainabilityFlag,
  ReviewFile,
  ReviewItem,
  ReviewRule,
} from "./review-checklist";
export type { HiddenChar, HiddenKind } from "./hidden-chars";
// Roadmap Phase 5b: protected paths blocked before an agent edits them (pre-tool-use hooks).
export { patchTargets, preToolAnswer, preToolHit, repoRelative, toolTargets } from "./pre-tool";
export type { PreToolAgent, PreToolHit, PreToolMode } from "./pre-tool";
// Roadmap Phase 5c: a definition of done when a request is captured (no AI).
export { DONE_NOTE_LIMIT, definitionOfDone, matchFeatureByWords } from "./definition-of-done";
export type { DoneNoteInput } from "./definition-of-done";
// Roadmap Phase 6: approval policies (risk levels, presets, rules; agents only ask, the owner decides).
export {
  APPROVAL_ACTIONS,
  DEFAULT_POLICY,
  MAX_RULES,
  PRESETS,
  REQUEST_TTL_MS,
  decide,
  isApprovalAction,
  loosens,
  parsePolicy,
} from "./approvals";
export type {
  ApprovalAction,
  ApprovalRule,
  ApprovalSubject,
  Choice,
  Policy,
  Preset,
  Risk,
} from "./approvals";
