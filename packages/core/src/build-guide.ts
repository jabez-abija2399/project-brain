// Roadmap Phase 9: "How do you build?" on the start page. The answer picks the first steps shown for that way of
// building and is remembered in a cookie (a display preference only: it unlocks nothing). Fixed words, no AI.

export const BUILD_COOKIE = "codeceipt_build";
export const BUILD_STYLES = ["claude", "cursor", "codex", "other", "spec"] as const;
export type BuildStyle = (typeof BUILD_STYLES)[number];

export const BUILD_LABELS: Record<BuildStyle, string> = {
  claude: "With Claude Code",
  cursor: "With Cursor",
  codex: "With Codex",
  other: "With another agent",
  spec: "I already have a spec or a build kit",
};

/** The remembered answer, or null when there is none (or it is not one of ours). */
export function buildStyle(
  query: string | undefined,
  cookie: string | undefined,
): BuildStyle | null {
  const pick = query ?? cookie;
  return (BUILD_STYLES as readonly string[]).includes(pick ?? "") ? (pick as BuildStyle) : null;
}

const CONNECT =
  "In your repository, run `npx codeceipt`: approve the code in your browser and the repo is connected.";

/** The first steps for one way of building (each a plain sentence; commands in backticks). */
export function buildGuide(style: BuildStyle): string[] {
  switch (style) {
    case "claude":
      return [
        CONNECT,
        "Say yes when it offers the Codeceipt plugin for Claude Code (or install it later from `/plugin` in Claude Code).",
        "Start a session and type `/codeceipt-feature` to build one feature step by step.",
      ];
    case "cursor":
      return [
        CONNECT,
        "Say yes when it offers the Codeceipt plugin for Cursor, or install it from Customize, Plugins.",
        "Ask Cursor to build something: the receipt appears when the session ends.",
      ];
    case "codex":
      return [
        CONNECT,
        "It sets up Codex for this repo (the MCP server and the hooks), or offers the Codeceipt plugin.",
        "Ask Codex to use the codeceipt-feature skill to build one feature step by step.",
      ];
    case "other":
      return [
        CONNECT,
        "Run `codeceipt init` to set up the agents it finds (MCP config, rules and AGENTS.md).",
        "If your agent has no session-end event, run `codeceipt receipt` after each session.",
      ];
    case "spec":
      return [
        CONNECT,
        "Run `codeceipt import`: your kit's features.json, Spec Kit, Kiro, OpenSpec, AGENTS.md or README becomes a plan draft.",
        "Approve the draft on your project's Plan tab; then `codeceipt export --to agents --write` keeps AGENTS.md in step.",
      ];
  }
}
