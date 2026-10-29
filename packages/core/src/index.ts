export const PACKAGE = "@brain/core";
export const VERSION = "0.0.0";

export { indexRepo, indexSources } from "./indexer";
export { pathSkipReason } from "./indexer/walker";
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
  featureFromPath,
  groupFeatures,
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
export { fixPrompt, receiptView, safeDisplay, safePath } from "./fix-prompt";
export type { ReceiptItemStatus, ReceiptView } from "./fix-prompt";
export { isLocalEnvFile, MAX_SCAN_BYTES, scanSecrets, SECRET_TYPES } from "./secrets";
export type { SecretFinding, SecretType } from "./secrets";
export { rlsFindings, secretFinding } from "./receipt-findings";
export type { Finding, FindingType, StoredTable } from "./receipt-findings";
export {
  addedDependencies,
  assessPackage,
  isValidPackageName,
  isValidVersion,
  KNOWN_HALLUCINATED,
  RELEASE_COOLDOWN_DAYS,
  summarizePackument,
} from "./package-check";
export type { AddedDependency, PackageCheck, RegistryAnswer } from "./package-check";
export {
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
export { policyAllowsAll, readSupabaseMigrations, rlsFlags } from "./supabase";
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
  MAX_ANSWER_CHARS,
  MAX_IDEA_CHARS,
  PlanRejectedError,
  checkDraft,
  draftHash,
  parseStage1,
  planStage1,
  planStage2,
} from "./plan";
export type { PlanDraft, PlanFeature, PlanItem, PlanQuestion, PlanStage1 } from "./plan";
