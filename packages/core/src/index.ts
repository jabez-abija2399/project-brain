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
