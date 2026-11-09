import {
  type PreToolAgent,
  preToolAnswer,
  preToolHit,
  repoRelative,
  toolTargets,
} from "@brain/core";
import { readSettings } from "./config";
import { gitDirOf, readBoundaryCache, readRepoLink } from "./repo-link";
import { type Git, repoRoot } from "./scan-secrets";

// Roadmap Phase 5b: `codeceipt hook pre-tool --agent <agent>`. Before the agent writes a file, the file is checked
// against the Blueprint's protected paths kept on this computer (refreshed at session start and by `codeceipt
// guard`). No network and no AI, so it answers in milliseconds. Anything unexpected lets the tool run (the agent's
// session is never broken by Codeceipt); `codeceipt guard` still checks the change at commit time.
const AGENTS = new Set<PreToolAgent>(["claude", "cursor", "codex", "antigravity"]);

export async function runPreToolHook(
  agent: string,
  input: string,
  folder: string,
  deps: { git: Git; stdout: (line: string) => void; configFile: string },
): Promise<void> {
  if (!AGENTS.has(agent as PreToolAgent)) return;
  const mode = readSettings(deps.configFile).guard ?? "strict";
  if (mode === "off") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return;
  }
  const targets = toolTargets(parsed);
  if (targets.length === 0) return;
  const root = await repoRoot(deps.git, folder).catch(() => null);
  const gitDir = root ? await gitDirOf(deps.git, root) : null;
  if (!root || !gitDir) return;
  const link = readRepoLink(gitDir);
  if (!link) return;
  const boundaries = readBoundaryCache(gitDir, link.projectId);
  if (!boundaries || boundaries.length === 0) return;
  const cwd =
    typeof (parsed as { cwd?: unknown }).cwd === "string"
      ? (parsed as { cwd: string }).cwd
      : folder;
  const inside = targets
    .map((t) => repoRelative(t, root, cwd))
    .filter((p): p is string => p !== null);
  const hit = preToolHit(inside, boundaries);
  if (!hit) return;
  const answer = preToolAnswer(agent as PreToolAgent, mode, hit);
  if (answer) deps.stdout(answer);
}
