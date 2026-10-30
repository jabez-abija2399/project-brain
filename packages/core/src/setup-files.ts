// First-receipt fix: the files `codeceipt init` adds or changes are Codeceipt's own setup, not the user's work, so a
// receipt never counts them as changed files or as outside the request's scope. Only exactly these paths (and the
// Codeceipt section of AGENTS.md, which the CLI checks by content) count; the user's other rules, skills and settings
// in the same folders are their own changes.
const SETUP_FILES = new Set([
  ".mcp.json",
  ".claude/settings.json",
  ".cursor/mcp.json",
  ".cursor/hooks.json",
  ".cursor/rules/codeceipt.mdc",
  ".cursor/rules/projectbrain.mdc",
  ".codex/config.toml",
  ".codex/hooks.json",
  "opencode.json",
  ".opencode/plugins/codeceipt.js",
  ".agents/mcp_config.json",
  ".agents/hooks.json",
  ".agents/rules/codeceipt.md",
]);
const SETUP_FOLDERS = [
  ".claude/skills/codeceipt/",
  ".claude/skills/projectbrain/",
  ".agents/skills/codeceipt/",
];

/** True for a repo-relative path that `codeceipt init` writes (AGENTS.md is decided by its content instead). */
export function isCodeceiptSetupPath(path: string): boolean {
  return SETUP_FILES.has(path) || SETUP_FOLDERS.some((folder) => path.startsWith(folder));
}

// The markers init puts around its AGENTS.md section, now and before the rename (D-019).
const SECTION =
  /\n*<!-- (?:codeceipt|projectbrain):start -->[\s\S]*?<!-- (?:codeceipt|projectbrain):end -->\n*/g;

/** AGENTS.md text without the section init adds, so two versions can be compared for the user's own changes. */
export function withoutAgentsSection(text: string): string {
  const rest = text.replace(SECTION, "\n");
  return rest.trim() === "" ? "" : `${rest.trimEnd()}\n`;
}
