// D-028: `codeceipt init --remove-repo-files`. For each agent whose Codeceipt plugin is installed on this computer,
// removes what `codeceipt init` wrote into the repo for it, and only that: a hook, server or file counts as ours only
// when it is exactly what init writes (an edited one, or one that merely looks like ours, stays and is reported).
// The shared skill and the AGENTS.md section go only when no agent in the repo still relies on per-repo files.
import {
  constants,
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { AGENTS, AGENT_NAMES, type Agent, codexServer, isOurHelper } from "./init-command";
import { pluginInstalled } from "./plugins";
import {
  AGENTS_END,
  AGENTS_START,
  ANTIGRAVITY_RULE,
  ANTIGRAVITY_RULE_PATH,
  CLAUDE_SKILL,
  CLAUDE_SKILL_PATH,
  CURSOR_RULE,
  CURSOR_RULE_PATH,
  END_HOOK,
  OPENCODE_PLUGIN_PATH,
  PRE_TOOL_HOOK,
  PROMPT_HOOK,
  SERVER_NAME,
  SHARED_SKILL,
  SHARED_SKILL_PATH,
  START_HOOK,
  STOP_HOOK,
  antigravityMcpServer,
  cursorMcpServer,
  isOurHook,
} from "./templates";

// Backlog (D-028 review LOW): the path is checked, then read or rewritten through a descriptor opened without
// following a symlink and checked again, so a file swapped for a link in between is never read or written through.
// O_NOFOLLOW does not exist on Windows (0 there): the lstat check in safe() is what applies.
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
// Null when the path is no longer a regular file (a symlink now, a folder, gone): it is then left alone.
function readNoFollow(abs: string): string | null {
  let fd: number;
  try {
    fd = openSync(abs, constants.O_RDONLY | NOFOLLOW);
  } catch {
    return null;
  }
  try {
    return fstatSync(fd).isFile() ? readFileSync(fd, "utf8") : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
function writeNoFollow(abs: string, text: string): boolean {
  let fd: number;
  try {
    fd = openSync(abs, constants.O_WRONLY | NOFOLLOW);
  } catch {
    return false;
  }
  try {
    if (!fstatSync(fd).isFile()) return false;
    // Truncated only after the descriptor is known to be the regular file.
    ftruncateSync(fd, 0);
    writeFileSync(fd, text);
    return true;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Which files say an agent was set up in this repo by init.
const FILES: Record<Agent, string[]> = {
  claude: [".claude/settings.json", ".mcp.json", CLAUDE_SKILL_PATH],
  cursor: [".cursor/hooks.json", ".cursor/mcp.json", CURSOR_RULE_PATH],
  codex: [".codex/hooks.json", ".codex/config.toml"],
  opencode: [OPENCODE_PLUGIN_PATH, "opencode.json"],
  antigravity: [".agents/hooks.json", ".agents/mcp_config.json", ANTIGRAVITY_RULE_PATH],
};

class Remover {
  readonly lines: string[] = [];
  private readonly realRoot: string;
  constructor(private readonly root: string) {
    this.realRoot = realpathSync(root);
  }

  // Only a regular file inside the repo (no symlink, no parent folder that leads outside).
  private safe(rel: string): string | null {
    const abs = join(this.root, rel);
    try {
      if (!lstatSync(abs).isFile()) return null;
      const real = realpathSync(dirname(abs));
      if (real !== this.realRoot && !real.startsWith(this.realRoot + sep)) return null;
      return abs;
    } catch {
      return null;
    }
  }

  private dropEmptyFolders(abs: string) {
    let dir = dirname(abs);
    while (dir.startsWith(this.root + sep)) {
      try {
        if (readdirSync(dir).length > 0) return;
        rmdirSync(dir);
      } catch {
        return;
      }
      dir = dirname(dir);
    }
  }

  file(rel: string, text: string) {
    const abs = this.safe(rel);
    if (!abs) return;
    const now = readNoFollow(abs);
    if (now === null) return;
    if (now !== text) return void this.lines.push(`  kept    ${rel} (changed by you)`);
    rmSync(abs);
    this.dropEmptyFolders(abs);
    this.lines.push(`  removed  ${rel}`);
  }

  json(rel: string, change: (doc: Json) => string[]) {
    const abs = this.safe(rel);
    if (!abs) return;
    let doc: unknown;
    try {
      doc = JSON.parse(readNoFollow(abs) ?? "null");
    } catch {
      return;
    }
    if (!isObject(doc)) return;
    const removed = change(doc);
    if (removed.length === 0) return;
    const meaningful = Object.keys(doc).filter((k) => k !== "version" && k !== "$schema");
    if (meaningful.length === 0) {
      rmSync(abs);
      this.dropEmptyFolders(abs);
    } else {
      writeNoFollow(abs, `${JSON.stringify(doc, null, 2)}\n`);
    }
    for (const what of removed) this.lines.push(`  removed  ${rel}: ${what}`);
  }

  codexToml(rel: string) {
    const abs = this.safe(rel);
    if (!abs) return;
    const text = readNoFollow(abs);
    if (text === null || codexServer(text) !== "ours") return;
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.trim() === "[mcp_servers.codeceipt]");
    const from = at > 0 && lines[at - 1]?.startsWith("# Codeceipt (added by") ? at - 1 : at;
    const rest = [...lines.slice(0, from), ...lines.slice(at + 3)]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    if (rest.trim() === "") {
      rmSync(abs);
      this.dropEmptyFolders(abs);
    } else writeNoFollow(abs, rest);
    this.lines.push(`  removed  ${rel}: MCP server ${SERVER_NAME}`);
  }

  agentsSection() {
    const abs = this.safe("AGENTS.md");
    if (!abs) return;
    const text = readNoFollow(abs);
    if (text === null) return;
    const from = text.indexOf(AGENTS_START);
    const to = text.indexOf(AGENTS_END, from);
    if (from === -1 || to === -1) return;
    const rest = `${text.slice(0, from).replace(/\n+$/, "")}${text.slice(to + AGENTS_END.length).replace(/^\n+/, "\n")}`;
    if (rest.trim() === "") rmSync(abs);
    else writeNoFollow(abs, rest.endsWith("\n") ? rest : `${rest}\n`);
    this.lines.push("  removed  AGENTS.md section");
  }
}

// Removes our hooks from event lists: Claude Code / Codex groups ({ hooks: [...] }) or Cursor's flat items.
function removeHooks(hooks: unknown, events: [string, string][], grouped: boolean): string[] {
  if (!isObject(hooks)) return [];
  const removed: string[] = [];
  for (const [event, command] of events) {
    const list = hooks[event];
    if (!Array.isArray(list)) continue;
    const ours = (h: unknown) => isObject(h) && isOurHook(h.command, command);
    const kept = grouped
      ? list.filter(
          (g) =>
            !(isObject(g) && Array.isArray(g.hooks) && g.hooks.length > 0 && g.hooks.every(ours)),
        )
      : list.filter((h) => !ours(h));
    if (kept.length === list.length) continue;
    removed.push(`${event} hook`);
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  return removed;
}
const removeServer = (key: string, isOurs: (entry: unknown) => boolean) => (doc: Json) => {
  const servers = doc[key];
  if (!isObject(servers) || !isOurs(servers[SERVER_NAME])) return [];
  delete servers[SERVER_NAME];
  if (Object.keys(servers).length === 0) delete doc[key];
  return [`MCP server ${SERVER_NAME}`];
};
const claudeServer = (entry: unknown) =>
  isObject(entry) &&
  Object.keys(entry).sort().join() === "headersHelper,type,url" &&
  entry.type === "http" &&
  isOurHelper(entry.headersHelper) &&
  typeof entry.url === "string" &&
  /^https:\/\/[^/\s]+\/mcp$/.test(entry.url);
const hooksIn = (events: [string, string][], grouped: boolean) => (doc: Json) => {
  const removed = removeHooks(doc.hooks, events, grouped);
  if (isObject(doc.hooks) && Object.keys(doc.hooks).length === 0)
    Reflect.deleteProperty(doc, "hooks");
  return removed;
};

/** Runs `init --remove-repo-files` in a repo; returns the report lines. */
export function removeRepoFiles(root: string, home: string): string[] {
  const r = new Remover(root);
  const has = (a: Agent) => FILES[a].some((f) => existsSync(join(root, f)));
  const present = AGENTS.filter(has);
  const covered = present.filter((a) => a !== "opencode" && pluginInstalled(home, a));
  const remaining = present.filter((a) => !covered.includes(a));
  for (const a of remaining) {
    r.lines.push(
      a === "opencode"
        ? "OpenCode: there is no Codeceipt plugin for OpenCode; its repo files stay"
        : `${AGENT_NAMES[a]}: the Codeceipt plugin is not installed; its repo files stay (install the plugin first)`,
    );
  }
  for (const a of covered) {
    r.lines.push(
      `${AGENT_NAMES[a]}: the Codeceipt plugin is installed; removing this repo's own files`,
    );
    if (a === "claude") {
      const events: [string, string][] = [
        ["SessionStart", START_HOOK("claude")],
        ["SessionEnd", END_HOOK("claude")],
        ["UserPromptSubmit", PROMPT_HOOK("claude")],
        ["Stop", STOP_HOOK("claude")],
        ["PreToolUse", PRE_TOOL_HOOK("claude")],
      ];
      r.json(".claude/settings.json", hooksIn(events, true));
      r.json(".mcp.json", removeServer("mcpServers", claudeServer));
      r.file(CLAUDE_SKILL_PATH, CLAUDE_SKILL);
    } else if (a === "cursor") {
      const events: [string, string][] = [
        ["sessionStart", START_HOOK("cursor")],
        ["sessionEnd", END_HOOK("cursor")],
        ["beforeSubmitPrompt", PROMPT_HOOK("cursor")],
        ["stop", STOP_HOOK("cursor")],
        ["preToolUse", PRE_TOOL_HOOK("cursor")],
      ];
      r.json(".cursor/hooks.json", hooksIn(events, false));
      r.json(
        ".cursor/mcp.json",
        removeServer("mcpServers", (e) => same(e, cursorMcpServer(""))),
      );
      r.file(CURSOR_RULE_PATH, CURSOR_RULE);
    } else if (a === "codex") {
      const events: [string, string][] = [
        ["SessionStart", START_HOOK("codex")],
        ["SessionEnd", END_HOOK("codex")],
        ["UserPromptSubmit", PROMPT_HOOK("codex")],
        ["PreToolUse", PRE_TOOL_HOOK("codex")],
      ];
      r.json(".codex/hooks.json", hooksIn(events, true));
      r.codexToml(".codex/config.toml");
    } else if (a === "antigravity") {
      r.json(".agents/hooks.json", (doc) => {
        const mine = doc[SERVER_NAME];
        const handlers = isObject(mine) ? Object.entries(mine) : [];
        const allOurs =
          handlers.length > 0 &&
          handlers.every(
            ([event, list]) =>
              event === "SessionStart" &&
              Array.isArray(list) &&
              list.every((h) => isObject(h) && isOurHook(h.command, START_HOOK("antigravity"))),
          );
        if (!allOurs) return [];
        delete doc[SERVER_NAME];
        return ["SessionStart hook"];
      });
      r.json(
        ".agents/mcp_config.json",
        removeServer("mcpServers", (e) => same(e, antigravityMcpServer())),
      );
      r.file(ANTIGRAVITY_RULE_PATH, ANTIGRAVITY_RULE);
    }
  }
  if (
    covered.length > 0 &&
    !remaining.some((a) => a === "codex" || a === "opencode" || a === "antigravity")
  ) {
    r.file(SHARED_SKILL_PATH, SHARED_SKILL);
  }
  if (covered.length > 0 && remaining.length === 0) r.agentsSection();
  if (present.length === 0)
    r.lines.push("This repo has no per-repo Codeceipt files; nothing to remove.");
  return r.lines;
}
