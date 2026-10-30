// The product's name as users see it (D-019: renamed from "Project Brain"). Internal names (@brain/* packages, the
// database) are unchanged. The legacy names are still read where users may have them set up (CLI, ignore file, env).
export const PRODUCT_NAME = "Codeceipt";
export const TAGLINE = "A receipt for every AI change.";
// The CLI command, MCP server name, config folder and ignore file stem.
export const CLI_NAME = "codeceipt";
export const LEGACY_PRODUCT_NAME = "Project Brain";
export const LEGACY_CLI_NAME = "projectbrain";

/** An environment variable by its new name (CODECEIPT_X), falling back to the old one (PROJECTBRAIN_X). */
export function brandEnv(
  env: Record<string, string | undefined>,
  name: string,
): string | undefined {
  return env[`CODECEIPT_${name}`] ?? env[`PROJECTBRAIN_${name}`];
}
