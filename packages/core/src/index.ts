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
export { DEFAULT_MODEL, createLlm, errorType } from "./llm";
export type { CompleteRequest, Llm, LlmClient, LlmCostEntry, LlmOptions } from "./llm";

export { maskSecret, maskSecretsIn } from "./mask";
export { oneLineText } from "./text";
export {
  DIRECTIVE_BUDGET,
  HANDOFF_LIMIT,
  buildHandoffNote,
  type HandoffInput,
} from "./handoff";
export { readSupabaseMigrations } from "./supabase";
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
  TableSchema,
} from "./supabase";
