import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  type PreToolAgent,
  type PreToolHit,
  preToolAnswer,
  preToolHit,
  repoRelative,
  toolTargets,
} from "@brain/core";
import { readSettings } from "./config";
import { PRE_TOOL_INPUT_TOO_LARGE } from "./hook-input";
import { gitDirOf, readBoundaryCache, readRepoLink } from "./repo-link";
import { type Git, repoRoot } from "./scan-secrets";

// Roadmap Phase 5b: `codeceipt hook pre-tool --agent <agent>`. Before the agent writes a file, the file is checked
// against the Blueprint's protected paths kept on this computer (refreshed at session start and by `codeceipt
// guard`). No network and no AI, so it answers in milliseconds. A repo that is not linked lets the tool run; in a
// linked repo, anything the hook cannot check (an input too large to read, too many files) is refused in strict mode.
// `codeceipt guard` still checks the change at commit time.
const AGENTS = new Set<PreToolAgent>(["claude", "cursor", "codex", "antigravity"]);

type Deps = {
  git: Git;
  stdout: (line: string) => void;
  configFile: string;
  home?: string;
  platform?: NodeJS.Platform;
};

/** The real path of `abs`: its deepest existing folder through symlinks, then the rest as written. */
function realOf(abs: string): string {
  let existing = abs;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    const up = dirname(existing);
    if (up === existing) return abs;
    rest.unshift(existing.slice(up.length).replace(/^[\\/]+/, ""));
    existing = up;
  }
  try {
    return join(realpathSync.native(existing), ...rest);
  } catch {
    return abs;
  }
}

export async function runPreToolHook(
  agent: string,
  input: string,
  folder: string,
  deps: Deps,
): Promise<void> {
  if (!AGENTS.has(agent as PreToolAgent)) return;
  const mode = readSettings(deps.configFile).guard ?? "strict";
  if (mode === "off") return;
  const root = await repoRoot(deps.git, folder).catch(() => null);
  const gitDir = root ? await gitDirOf(deps.git, root) : null;
  if (!root || !gitDir) return;
  const link = readRepoLink(gitDir);
  if (!link) return;
  const boundaries = readBoundaryCache(gitDir, link.projectId) ?? [];
  const answer = (hit: PreToolHit) => {
    const text = preToolAnswer(agent as PreToolAgent, mode, hit);
    if (text) deps.stdout(text);
  };
  // Security review (Phase 5b): an edit too large for the hook's input limit is refused, never let through unread.
  if (input === PRE_TOOL_INPUT_TOO_LARGE) {
    if (boundaries.some((b) => b.kind === "protected_path")) {
      answer({ path: "(this edit)", pattern: "(too large to check)" });
    }
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return;
  }
  const targets = toolTargets(parsed);
  if (targets.length === 0) return;
  const cwdField = (parsed as { cwd?: unknown } | null)?.cwd;
  const cwd = typeof cwdField === "string" && isAbsolute(cwdField) ? cwdField : folder;
  const platform = deps.platform ?? process.platform;
  const opts = {
    caseInsensitive: platform === "darwin" || platform === "win32",
    windows: platform === "win32",
  };
  const realRoot = realOf(root);
  const settingsFile = realOf(resolve(deps.configFile));
  const inside = new Set<string>();
  for (const raw of targets) {
    const t =
      deps.home && (raw === "~" || raw.startsWith("~/")) ? join(deps.home, raw.slice(1)) : raw;
    const abs = isAbsolute(t) ? t : resolve(cwd, t);
    const real = realOf(abs);
    // Codeceipt's own settings (where the guard can be switched off) are never written by an agent's file tool.
    if (real === settingsFile)
      return answer({ path: "(Codeceipt settings)", pattern: "(Codeceipt's own settings)" });
    // Both the path as written and its real path (a symlinked folder, another spelling of the repo's folder).
    for (const p of [repoRelative(abs, root, cwd, opts), repoRelative(real, realRoot, cwd, opts)]) {
      if (p !== null) inside.add(p);
    }
  }
  const hit = preToolHit([...inside], boundaries);
  if (hit) answer(hit);
}
