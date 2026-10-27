export const PACKAGE = "@brain/core";
export const VERSION = "0.0.0";

export { indexRepo } from "./indexer";
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
export type { FeatureGroup, FeatureMap, SharedFile } from "./features";

export { maskSecret, maskSecretsIn } from "./mask";
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
