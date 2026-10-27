// Wire format between the reader (packages/core, MigrationSandbox) and the sandbox child. Defined once in core; the
// core tests pass createPgliteSandbox() where a MigrationSandbox is expected.
export type {
  PolicyKey,
  PolicyTrees,
  SandboxPolicy,
  SandboxRun,
  SandboxStatement,
  SandboxStep,
  SandboxTable,
} from "@brain/core";
