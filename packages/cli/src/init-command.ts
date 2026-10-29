import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { CliError, EXIT } from "./api";
import type { CliConfig } from "./config";
import {
  AGENTS_SECTION,
  AGENTS_START,
  CLAUDE_SKILL,
  CURSOR_RULE,
  END_HOOK,
  START_HOOK,
  claudeMcpServer,
  cursorMcpServer,
  isOurHook,
} from "./templates";

// FEAT-016: `projectbrain init` sets up Claude Code and Cursor for this repo: MCP config, hooks, the Skill or rule,
// and an AGENTS.md section. It only adds what is missing (a second run adds nothing), never changes or removes what
// the user wrote, and never writes the project token into the repo.
type Agent = "claude" | "cursor";
type Json = Record<string, unknown>;

export type InitResult = { agents: Agent[]; added: string[]; kept: string[]; skipped: string[] };

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function detectAgents(root: string, home: string, args: string[]): Agent[] {
  const forced = (["claude", "cursor"] as const).filter((a) => args.includes(`--${a}`));
  if (forced.length > 0) return forced;
  const found: Agent[] = [];
  if ([join(root, ".claude"), join(root, "CLAUDE.md"), join(home, ".claude")].some(existsSync)) {
    found.push("claude");
  }
  if ([join(root, ".cursor"), join(home, ".cursor")].some(existsSync)) found.push("cursor");
  return found;
}

class Writer {
  readonly result: InitResult = { agents: [], added: [], kept: [], skipped: [] };
  private readonly realRoot: string;
  constructor(private readonly root: string) {
    this.realRoot = realpathSync(root);
  }

  // A target is written only when it and its existing parent folders resolve inside the repo and it is not a
  // symlink, so a cloned repo cannot point AGENTS.md or a config file at something outside it.
  private safe(rel: string): string | null {
    const abs = join(this.root, rel);
    let at = dirname(abs);
    while (!existsSync(at)) at = dirname(at);
    const real = realpathSync(at);
    if (real !== this.realRoot && !real.startsWith(this.realRoot + sep)) return null;
    try {
      if (lstatSync(abs).isSymbolicLink()) return null;
    } catch {}
    return abs;
  }

  private write(abs: string, text: string) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }

  // A file that should exist once (Skill, rule): created when missing, never replaced.
  file(rel: string, text: string) {
    const abs = this.safe(rel);
    if (!abs) return void this.result.skipped.push(`${rel} (a symlink or outside the repo)`);
    if (existsSync(abs)) return void this.result.kept.push(rel);
    this.write(abs, text);
    this.result.added.push(rel);
  }

  // A JSON config: `change` adds what is missing and returns the names of what it added. A file that is not a JSON
  // object is left as it is.
  json(rel: string, change: (doc: Json) => string[]) {
    const abs = this.safe(rel);
    if (!abs) return void this.result.skipped.push(`${rel} (a symlink or outside the repo)`);
    let doc: Json = {};
    if (existsSync(abs)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(abs, "utf8"));
      } catch {
        parsed = null;
      }
      if (!isObject(parsed))
        return void this.result.skipped.push(`${rel} (not valid JSON; left unchanged)`);
      doc = parsed;
    }
    const added = change(doc);
    if (added.length === 0) return void this.result.kept.push(rel);
    this.write(abs, `${JSON.stringify(doc, null, 2)}\n`);
    for (const what of added) this.result.added.push(`${rel}: ${what}`);
  }

  agentsSection() {
    const abs = this.safe("AGENTS.md");
    if (!abs) return void this.result.skipped.push("AGENTS.md (a symlink or outside the repo)");
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : "";
    if (current.includes(AGENTS_START)) return void this.result.kept.push("AGENTS.md section");
    const sep = current === "" ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    this.write(abs, `${current}${sep}${AGENTS_SECTION}\n`);
    this.result.added.push("AGENTS.md section");
  }
}

function addServer(server: Json) {
  return (doc: Json): string[] => {
    if (doc.mcpServers !== undefined && !isObject(doc.mcpServers)) return [];
    doc.mcpServers ??= {};
    const servers = doc.mcpServers as Json;
    if (servers.projectbrain !== undefined) return [];
    servers.projectbrain = server;
    return ["MCP server projectbrain"];
  };
}

// Adds our hook to an event's list unless one of ours is already there; the user's hooks are never touched.
function addHook(
  hooks: Json,
  event: string,
  entry: Json,
  ours: (item: unknown) => boolean,
): string[] {
  const list = hooks[event];
  if (list !== undefined && !Array.isArray(list)) return [];
  if ((list ?? []).some(ours)) return [];
  hooks[event] = [...(list ?? []), entry];
  return [`${event} hook`];
}

const claudeHooks = (doc: Json): string[] => {
  if (doc.hooks !== undefined && !isObject(doc.hooks)) return [];
  doc.hooks ??= {};
  const hooks = doc.hooks as Json;
  const ours = (group: unknown) =>
    isObject(group) &&
    Array.isArray(group.hooks) &&
    group.hooks.some((h) => isObject(h) && isOurHook(h.command));
  const entry = (command: string, timeout: number) => ({
    hooks: [{ type: "command", command, timeout }],
  });
  return [
    ...addHook(hooks, "SessionStart", entry(START_HOOK("claude"), 30), ours),
    // SessionEnd hooks get 1.5 s unless they set a timeout; the receipt needs more (Claude Code allows up to 60 s).
    ...addHook(hooks, "SessionEnd", entry(END_HOOK("claude"), 60), ours),
  ];
};

const cursorHooks = (doc: Json): string[] => {
  if (doc.hooks !== undefined && !isObject(doc.hooks)) return [];
  doc.version ??= 1;
  doc.hooks ??= {};
  const hooks = doc.hooks as Json;
  const ours = (item: unknown) => isObject(item) && isOurHook(item.command);
  return [
    ...addHook(hooks, "sessionStart", { command: START_HOOK("cursor"), timeout: 30 }, ours),
    ...addHook(hooks, "sessionEnd", { command: END_HOOK("cursor"), timeout: 60 }, ours),
  ];
};

export function runInit(root: string, home: string, config: CliConfig, args: string[]): InitResult {
  const unknown = args.find((a) => a !== "--claude" && a !== "--cursor");
  if (unknown) throw new CliError(EXIT.usage, `Unknown argument: ${unknown}`);
  const agents = detectAgents(root, home, args);
  if (agents.length === 0) {
    throw new CliError(
      EXIT.usage,
      "Found neither Claude Code nor Cursor: run `projectbrain init --claude` or `projectbrain init --cursor`.",
    );
  }
  const w = new Writer(root);
  w.result.agents = agents;
  if (agents.includes("claude")) {
    w.json(".mcp.json", addServer(claudeMcpServer(config.apiUrl)));
    w.json(".claude/settings.json", claudeHooks);
    w.file(".claude/skills/projectbrain/SKILL.md", CLAUDE_SKILL);
  }
  if (agents.includes("cursor")) {
    w.json(".cursor/mcp.json", addServer(cursorMcpServer(config.apiUrl)));
    w.json(".cursor/hooks.json", cursorHooks);
    w.file(".cursor/rules/projectbrain.mdc", CURSOR_RULE);
  }
  w.agentsSection();
  return w.result;
}

export function initReport(r: InitResult, root: string, cwd: string): string[] {
  const where = relative(cwd, root) || ".";
  return [
    `Set up ${r.agents.map((a) => (a === "claude" ? "Claude Code" : "Cursor")).join(" and ")} in ${where}`,
    ...r.added.map((a) => `  added   ${a}`),
    ...r.kept.map((k) => `  kept    ${k} (already set up)`),
    ...r.skipped.map((s) => `  skipped ${s}`),
    "The token is not stored in the repo. Set PROJECTBRAIN_TOKEN in your shell profile for Cursor (Claude Code reads",
    "it from your `projectbrain login` once you trust this folder). The hooks need `projectbrain` on your PATH.",
  ];
}
