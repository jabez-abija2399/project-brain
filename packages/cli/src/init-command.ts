import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { CliError, EXIT } from "./api";
import type { CliConfig } from "./config";
import {
  AGENTS_SECTION,
  AGENTS_START,
  ANTIGRAVITY_RULE,
  ANTIGRAVITY_RULE_PATH,
  CLAUDE_SKILL,
  CLAUDE_SKILL_PATH,
  CURSOR_RULE,
  CURSOR_RULE_PATH,
  END_HOOK,
  LEGACY_AGENTS_END,
  LEGACY_AGENTS_START,
  LEGACY_CLAUDE_SKILL,
  LEGACY_CLAUDE_SKILL_PATH,
  LEGACY_CURSOR_RULE,
  LEGACY_CURSOR_RULE_PATH,
  LEGACY_END_HOOK,
  LEGACY_SERVER_NAME,
  LEGACY_START_HOOK,
  OPENCODE_PLUGIN,
  OPENCODE_PLUGIN_PATH,
  SERVER_NAME,
  SHARED_SKILL,
  SHARED_SKILL_PATH,
  START_HOOK,
  TOKEN_VARIABLE,
  antigravityMcpServer,
  claudeMcpServer,
  codexMcpToml,
  cursorMcpServer,
  isOurHook,
  opencodeMcpServer,
} from "./templates";

// FEAT-016: `codeceipt init` sets up Claude Code and Cursor for this repo: MCP config, hooks, the Skill or rule,
// and an AGENTS.md section. It only adds what is missing (a second run adds nothing), never changes or removes what
// the user wrote, and never writes the project token into the repo. D-019: a setup made under the old name (Project
// Brain) is upgraded in place: our own entries are renamed, never duplicated; anything the user edited is left.
// D-021: the same for OpenAI Codex, OpenCode and Google Antigravity, with what each one cannot do in the report.
export const AGENTS = ["claude", "cursor", "codex", "opencode", "antigravity"] as const;
export type Agent = (typeof AGENTS)[number];
export const AGENT_NAMES: Record<Agent, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

// What an agent cannot do, said in init's report (D-021).
const LIMITS: Partial<Record<Agent, string>> = {
  codex:
    "Codex: reads .codex/ only in a trusted project and asks you to review new hooks in /hooks before they run; its session end allows 3 s, so the receipt finishes in the background.",
  opencode:
    "OpenCode: no session-end event, so no automatic receipt: run `codeceipt receipt` when you finish, or connect the GitHub App for receipts on push.",
  antigravity:
    "Antigravity: no session-end event, so no automatic receipt: run `codeceipt receipt` when you finish, or connect the GitHub App for receipts on push.",
};
type Json = Record<string, unknown>;

export type InitResult = { agents: Agent[]; added: string[]; kept: string[]; skipped: string[] };

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function detectAgents(
  root: string,
  home: string,
  args: string[],
  configHome?: string,
): Agent[] {
  const forced = AGENTS.filter((a) => args.includes(`--${a}`));
  if (forced.length > 0) return forced;
  const any = (...paths: string[]) => paths.some(existsSync);
  const signs: Record<Agent, boolean> = {
    claude: any(join(root, ".claude"), join(root, "CLAUDE.md"), join(home, ".claude")),
    cursor: any(join(root, ".cursor"), join(home, ".cursor")),
    codex: any(join(root, ".codex"), join(home, ".codex")),
    opencode: any(
      join(root, "opencode.json"),
      join(root, "opencode.jsonc"),
      join(root, ".opencode"),
      join(configHome ?? join(home, ".config"), "opencode"),
    ),
    // .agents/skills alone is shared with Codex and OpenCode, so it does not count.
    antigravity: any(
      join(root, ".agents", "rules"),
      join(root, ".agents", "hooks.json"),
      join(root, ".agents", "mcp_config.json"),
      join(root, ".agent"),
      join(home, ".gemini", "antigravity"),
      join(home, ".gemini", "config"),
    ),
  };
  return AGENTS.filter((a) => signs[a]);
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

  // A file that should exist once (Skill, rule): created when missing, never replaced. The same file under the old
  // name is moved when it is exactly what an older init wrote; an edited one is left alone and reported.
  file(rel: string, text: string, legacy?: { rel: string; text: string }) {
    const abs = this.safe(rel);
    if (!abs) return void this.result.skipped.push(`${rel} (a symlink or outside the repo)`);
    if (existsSync(abs)) return void this.result.kept.push(rel);
    const old = legacy ? this.safe(legacy.rel) : null;
    if (legacy && old && existsSync(old)) {
      let current: string | null = null;
      try {
        current = lstatSync(old).isFile() ? readFileSync(old, "utf8") : null;
      } catch {}
      if (current !== legacy.text) {
        return void this.result.skipped.push(
          `${legacy.rel} (changed by you; rename it to ${rel} yourself)`,
        );
      }
      this.write(abs, text);
      rmSync(old);
      try {
        rmdirSync(dirname(old));
      } catch {}
      return void this.result.added.push(`${rel} (replaces ${legacy.rel})`);
    }
    this.write(abs, text);
    this.result.added.push(rel);
  }

  // A JSON config: `change` adds what is missing and names what it added, plus anything it could not set up (an
  // unexpected shape, a foreign server). Such parts are left as they are and reported, never called "set up". A file
  // that is not a JSON object is left as it is.
  json(rel: string, change: (doc: Json) => Change) {
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
    const { added, problems } = change(doc);
    for (const p of problems) this.result.skipped.push(`${rel}: ${p}`);
    if (added.length === 0) {
      if (problems.length === 0) this.result.kept.push(rel);
      return;
    }
    this.write(abs, `${JSON.stringify(doc, null, 2)}\n`);
    for (const what of added) this.result.added.push(`${rel}: ${what}`);
  }

  // Codex's config.toml: our server is appended as its own table when no codeceipt server exists in any form. There
  // is no TOML parser here on purpose: anything that already defines a codeceipt server is left alone and reported.
  codexToml(rel: string) {
    const abs = this.safe(rel);
    if (!abs) return void this.result.skipped.push(`${rel} (a symlink or outside the repo)`);
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : "";
    const table = current.match(
      /^[ \t]*\[[ \t]*mcp_servers[ \t]*\.[ \t]*"?codeceipt"?[ \t]*\][^\n]*\n?((?:(?![ \t]*\[)[^\n]*\n?)*)/m,
    );
    if (table) {
      const body = table[1] ?? "";
      const proxy =
        /^[ \t]*command[ \t]*=[ \t]*"codeceipt"[ \t]*$/m.test(body) &&
        /^[ \t]*args[ \t]*=[ \t]*\[[ \t]*"mcp-proxy"/m.test(body) &&
        !/^[ \t]*(url|env|cwd|env_vars)[ \t]*=/m.test(body);
      if (proxy) return void this.result.kept.push(rel);
      return void this.result.skipped.push(
        `${rel}: its codeceipt server is not the codeceipt proxy; check it before trusting this folder`,
      );
    }
    if (/mcp_servers[ \t]*\.[ \t]*"?codeceipt"?|^[ \t]*"?codeceipt"?[ \t]*=/m.test(current)) {
      return void this.result.skipped.push(
        `${rel}: its codeceipt server is defined in a form init does not change; left unchanged`,
      );
    }
    const sep = current === "" || current.endsWith("\n") ? "" : "\n";
    this.write(abs, `${current}${sep}${current === "" ? codexMcpToml.trimStart() : codexMcpToml}`);
    this.result.added.push(`${rel}: MCP server ${SERVER_NAME}`);
  }

  agentsSection() {
    const abs = this.safe("AGENTS.md");
    if (!abs) return void this.result.skipped.push("AGENTS.md (a symlink or outside the repo)");
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : "";
    if (current.includes(AGENTS_START)) return void this.result.kept.push("AGENTS.md section");
    // Our section from before the rename: replaced in place (only the part between our own markers).
    const from = current.indexOf(LEGACY_AGENTS_START);
    const to = current.indexOf(LEGACY_AGENTS_END, from);
    if (from !== -1 && to !== -1) {
      const end = to + LEGACY_AGENTS_END.length;
      this.write(abs, `${current.slice(0, from)}${AGENTS_SECTION}${current.slice(end)}`);
      return void this.result.added.push("AGENTS.md section (upgraded from Project Brain)");
    }
    const sep = current === "" ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    this.write(abs, `${current}${sep}${AGENTS_SECTION}\n`);
    this.result.added.push("AGENTS.md section");
  }
}

type Change = { added: string[]; problems: string[] };

const originOf = (url: unknown) => {
  try {
    return typeof url === "string" ? new URL(url).origin : null;
  } catch {
    return null;
  }
};

// Our own entry: the same server, or the CLI's stdio proxy (Cursor).
// Our own entry: the same server, or the CLI's stdio proxy (Cursor, Antigravity; OpenCode writes the command as one
// list).
const ours = (entry: unknown, origin: string | null) =>
  isObject(entry) &&
  (originOf(entry.url) === origin ||
    (entry.command === "codeceipt" && Array.isArray(entry.args) && entry.args[0] === "mcp-proxy") ||
    (Array.isArray(entry.command) &&
      entry.command[0] === "codeceipt" &&
      entry.command[1] === "mcp-proxy"));
// Launch part 3: an entry of ours that still reads a token variable is replaced by the helper form.
const readsTokenVariable = (entry: unknown) =>
  isObject(entry) &&
  isObject(entry.headers) &&
  Object.values(entry.headers).some((v) => typeof v === "string" && TOKEN_VARIABLE.test(v));

function addServer(server: Json, apiUrl: string, key = "mcpServers") {
  const origin = originOf(apiUrl);
  return (doc: Json): Change => {
    if (doc[key] !== undefined && !isObject(doc[key])) {
      return { added: [], problems: [`${key} is not an object; left unchanged`] };
    }
    doc[key] ??= {};
    const servers = doc[key] as Json;
    const existing = servers[SERVER_NAME];
    const legacy = servers[LEGACY_SERVER_NAME];
    if (existing === undefined) {
      // Our entry from before the rename (same server): replaced by the current one, which needs no token variable.
      if (ours(legacy, origin)) {
        servers[SERVER_NAME] = server;
        delete servers[LEGACY_SERVER_NAME];
        return {
          added: [`MCP server ${SERVER_NAME} (renamed from ${LEGACY_SERVER_NAME})`],
          problems: [],
        };
      }
      servers[SERVER_NAME] = server;
      return {
        added: [`MCP server ${SERVER_NAME}`],
        problems:
          legacy === undefined
            ? []
            : [
                `its ${LEGACY_SERVER_NAME} server points at another address; check it before trusting this folder`,
              ],
      };
    }
    // An entry named codeceipt for another address is not ours: init does not vouch for it.
    if (!ours(existing, origin)) {
      return {
        added: [],
        problems: [
          `its ${SERVER_NAME} server points at another address; check it before trusting this folder`,
        ],
      };
    }
    if (readsTokenVariable(existing)) {
      servers[SERVER_NAME] = server;
      return {
        added: [`MCP server ${SERVER_NAME} (token now from the codeceipt helper)`],
        problems: [],
      };
    }
    return { added: [], problems: [] };
  };
}

// Adds our hook to an event's list unless ours is already there; the user's hooks are never touched. Our hook from
// before the rename is upgraded in place (`upgrade` rewrites its command and says whether it found one).
function addHook(
  hooks: Json,
  event: string,
  entry: Json,
  ours: (item: unknown) => boolean,
  upgrade: (list: unknown[]) => boolean,
): Change {
  const list = hooks[event];
  if (list !== undefined && !Array.isArray(list)) {
    return { added: [], problems: [`${event} is not a list; left unchanged`] };
  }
  if ((list ?? []).some(ours)) return { added: [], problems: [] };
  if (list && upgrade(list))
    return { added: [`${event} hook (upgraded from projectbrain)`], problems: [] };
  hooks[event] = [...(list ?? []), entry];
  return { added: [`${event} hook`], problems: [] };
}

// Rewrites the first hook whose command is `legacy` to `command`, keeping everything else about it.
function renameHookCommand(items: unknown[], legacy: string, command: string): boolean {
  for (const item of items) {
    if (isObject(item) && isOurHook(item.command, legacy)) {
      item.command = command;
      return true;
    }
  }
  return false;
}

const merge = (...changes: Change[]): Change => ({
  added: changes.flatMap((c) => c.added),
  problems: changes.flatMap((c) => c.problems),
});

// Claude Code's .claude/settings.json and Codex's .codex/hooks.json share this shape: { hooks: { Event: [group] } }.
const groupHooks =
  (agent: "claude" | "codex", endTimeout: number) =>
  (doc: Json): Change => {
    if (doc.hooks !== undefined && !isObject(doc.hooks)) {
      return { added: [], problems: ["hooks is not an object; left unchanged"] };
    }
    doc.hooks ??= {};
    const hooks = doc.hooks as Json;
    const ours = (command: string) => (group: unknown) =>
      isObject(group) &&
      Array.isArray(group.hooks) &&
      group.hooks.some((h) => isObject(h) && isOurHook(h.command, command));
    const entry = (command: string, timeout: number) => ({
      hooks: [{ type: "command", command, timeout }],
    });
    const upgrade = (legacy: string, command: string) => (groups: unknown[]) =>
      groups.some(
        (g) => isObject(g) && Array.isArray(g.hooks) && renameHookCommand(g.hooks, legacy, command),
      );
    return merge(
      addHook(
        hooks,
        "SessionStart",
        entry(START_HOOK(agent), 30),
        ours(START_HOOK(agent)),
        upgrade(LEGACY_START_HOOK(agent), START_HOOK(agent)),
      ),
      // Claude Code: SessionEnd hooks get 1.5 s unless they set a timeout; the receipt needs more (up to 60 s allowed).
      // Codex allows 3 s at most: its hook starts the receipt in the background and returns.
      addHook(
        hooks,
        "SessionEnd",
        entry(END_HOOK(agent), endTimeout),
        ours(END_HOOK(agent)),
        upgrade(LEGACY_END_HOOK(agent), END_HOOK(agent)),
      ),
    );
  };

const cursorHooks = (doc: Json): Change => {
  if (doc.hooks !== undefined && !isObject(doc.hooks)) {
    return { added: [], problems: ["hooks is not an object; left unchanged"] };
  }
  const hooks = (isObject(doc.hooks) ? doc.hooks : {}) as Json;
  const ours = (command: string) => (item: unknown) =>
    isObject(item) && isOurHook(item.command, command);
  const change = merge(
    addHook(
      hooks,
      "sessionStart",
      { command: START_HOOK("cursor"), timeout: 30 },
      ours(START_HOOK("cursor")),
      (items) => renameHookCommand(items, LEGACY_START_HOOK("cursor"), START_HOOK("cursor")),
    ),
    addHook(
      hooks,
      "sessionEnd",
      { command: END_HOOK("cursor"), timeout: 60 },
      ours(END_HOOK("cursor")),
      (items) => renameHookCommand(items, LEGACY_END_HOOK("cursor"), END_HOOK("cursor")),
    ),
  );
  if (change.added.length > 0) {
    doc.version ??= 1;
    doc.hooks = hooks;
  }
  return change;
};

// Antigravity's .agents/hooks.json maps hook names to events; ours is the hook named codeceipt with a SessionStart
// handler (Antigravity has no session-end event).
const antigravityHooks = (doc: Json): Change => {
  const command = START_HOOK("antigravity");
  const handler = { type: "command", command, timeout: 30 };
  const mine = doc[SERVER_NAME];
  if (mine === undefined) {
    doc[SERVER_NAME] = { SessionStart: [handler] };
    return { added: ["SessionStart hook"], problems: [] };
  }
  if (!isObject(mine)) {
    return { added: [], problems: [`its ${SERVER_NAME} hook is not an object; left unchanged`] };
  }
  return addHook(
    mine,
    "SessionStart",
    handler,
    (item) => isObject(item) && isOurHook(item.command, command),
    () => false,
  );
};

const OPENCODE_SCHEMA = "https://opencode.ai/config.json";
const opencodeConfig = (apiUrl: string) => {
  const add = addServer(opencodeMcpServer(), apiUrl, "mcp");
  return (doc: Json): Change => {
    if (Object.keys(doc).length === 0) doc.$schema = OPENCODE_SCHEMA;
    return add(doc);
  };
};

export function runInit(
  root: string,
  home: string,
  config: CliConfig,
  args: string[],
  configHome?: string,
): InitResult {
  const unknown = args.find((a) => !AGENTS.some((agent) => a === `--${agent}`));
  if (unknown) throw new CliError(EXIT.usage, `Unknown argument: ${unknown}`);
  const agents = detectAgents(root, home, args, configHome);
  if (agents.length === 0) {
    throw new CliError(
      EXIT.usage,
      "Found no supported agent: run `codeceipt init --claude` (or --cursor, --codex, --opencode, --antigravity).",
    );
  }
  const w = new Writer(root);
  w.result.agents = agents;
  if (agents.includes("claude")) {
    w.json(".mcp.json", addServer(claudeMcpServer(config.apiUrl), config.apiUrl));
    w.json(".claude/settings.json", groupHooks("claude", 60));
    w.file(CLAUDE_SKILL_PATH, CLAUDE_SKILL, {
      rel: LEGACY_CLAUDE_SKILL_PATH,
      text: LEGACY_CLAUDE_SKILL,
    });
  }
  if (agents.includes("cursor")) {
    w.json(".cursor/mcp.json", addServer(cursorMcpServer(config.apiUrl), config.apiUrl));
    w.json(".cursor/hooks.json", cursorHooks);
    w.file(CURSOR_RULE_PATH, CURSOR_RULE, {
      rel: LEGACY_CURSOR_RULE_PATH,
      text: LEGACY_CURSOR_RULE,
    });
  }
  if (agents.includes("codex")) {
    w.codexToml(".codex/config.toml");
    w.json(".codex/hooks.json", groupHooks("codex", 3));
  }
  if (agents.includes("opencode")) {
    // OpenCode reads opencode.jsonc too; a JSONC file (comments) is left to the user rather than rewritten.
    if (existsSync(join(root, "opencode.jsonc")) && !existsSync(join(root, "opencode.json"))) {
      w.result.skipped.push(
        `opencode.jsonc: add the codeceipt server to it yourself: "mcp": { "codeceipt": ${JSON.stringify(opencodeMcpServer())} }`,
      );
    } else {
      w.json("opencode.json", opencodeConfig(config.apiUrl));
    }
    w.file(OPENCODE_PLUGIN_PATH, OPENCODE_PLUGIN);
  }
  if (agents.includes("antigravity")) {
    w.json(".agents/mcp_config.json", addServer(antigravityMcpServer(), config.apiUrl));
    w.json(".agents/hooks.json", antigravityHooks);
    w.file(ANTIGRAVITY_RULE_PATH, ANTIGRAVITY_RULE);
  }
  if (agents.some((a) => a === "codex" || a === "opencode" || a === "antigravity")) {
    w.file(SHARED_SKILL_PATH, SHARED_SKILL);
  }
  w.agentsSection();
  return w.result;
}

export function agentList(agents: Agent[]): string {
  const names = agents.map((a) => AGENT_NAMES[a]);
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function initReport(r: InitResult, root: string, cwd: string): string[] {
  const where = relative(cwd, root) || ".";
  return [
    `Set up ${agentList(r.agents)} in ${where}`,
    ...r.added.map((a) => `  added   ${a}`),
    ...r.kept.map((k) => `  kept    ${k} (already set up)`),
    ...r.skipped.map((s) => `  skipped ${s}`),
    ...r.agents.flatMap((a) => (LIMITS[a] ? [LIMITS[a]] : [])),
    "The token is not stored in the repo: the agents get it from the codeceipt CLI (no environment variable to",
    "set). The hooks and the agents need `codeceipt` on your PATH (npm install -g codeceipt).",
  ];
}
