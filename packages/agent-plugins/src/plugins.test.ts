import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLI_VERSION } from "../../cli/src/templates.ts";
import { LAUNCHER, PLUGIN_AGENTS, generateMarketplace } from "./index.ts";

// D-028: one source, one plugin per agent. Each plugin's hooks and MCP server go through one launcher script that
// runs the installed codeceipt with fixed arguments, prints the installer line when it is missing, and never fails
// the agent's session. No token is in any plugin file. The token pattern is built at runtime.
const files = generateMarketplace();
const json = (path: string) => JSON.parse(files.get(path) ?? "null") as Record<string, unknown>;
const TOKEN_LIKE = new RegExp(["pb", "_(live|test)_"].join(""));
const MARKETPLACE = fileURLToPath(new URL("../marketplace", import.meta.url));

describe("one plugin per agent, from shared templates", () => {
  it("Claude Code: manifest, hooks/hooks.json with the four events, .mcp.json and the skill", () => {
    const root = "plugins/claude-code";
    expect(json(`${root}/.claude-plugin/plugin.json`)).toMatchObject({
      name: "codeceipt",
      version: CLI_VERSION,
    });
    const hooks = json(`${root}/hooks/hooks.json`).hooks as Record<
      string,
      { hooks: { command: string; timeout: number }[] }[]
    >;
    expect(Object.keys(hooks).sort()).toEqual([
      "SessionEnd",
      "SessionStart",
      "Stop",
      "UserPromptSubmit",
    ]);
    expect(hooks.SessionStart?.[0]?.hooks[0]?.command).toBe(
      'sh "${CLAUDE_PLUGIN_ROOT}/scripts/codeceipt.sh" hook session-start claude',
    );
    // Claude Code gives all SessionEnd hooks 1.5 s unless a hook asks for more (60 s at most).
    expect(hooks.SessionEnd?.[0]?.hooks[0]?.timeout).toBe(60);
    const mcp = json(`${root}/.mcp.json`).mcpServers as Record<
      string,
      { command: string; args: string[] }
    >;
    expect(mcp.codeceipt).toEqual({
      command: "sh",
      args: [
        "${CLAUDE_PLUGIN_ROOT}/scripts/codeceipt.sh",
        "mcp",
        "claude",
        "${CLAUDE_PROJECT_DIR}",
      ],
    });
    expect(files.get(`${root}/skills/codeceipt/SKILL.md`)).toMatch(
      /^---\nname: codeceipt\ndescription: /,
    );
    expect(files.get(`${root}/scripts/codeceipt.sh`)).toBe(LAUNCHER);
  });

  it("Cursor: manifest, hooks (version 1, sessionStart, beforeSubmitPrompt, sessionEnd, and stop for the Stop gate), mcp.json and an always-on rule", () => {
    const root = "plugins/cursor";
    expect(json(`${root}/.cursor-plugin/plugin.json`)).toMatchObject({
      name: "codeceipt",
      version: CLI_VERSION,
    });
    const doc = json(`${root}/hooks/hooks.json`);
    expect(doc.version).toBe(1);
    const hooks = doc.hooks as Record<string, { command: string }[]>;
    expect(Object.keys(hooks).sort()).toEqual([
      "beforeSubmitPrompt",
      "sessionEnd",
      "sessionStart",
      "stop",
    ]);
    expect(hooks.beforeSubmitPrompt?.[0]?.command).toBe(
      'sh "${CURSOR_PLUGIN_ROOT}/scripts/codeceipt.sh" hook prompt cursor',
    );
    const mcp = json(`${root}/mcp.json`).mcpServers as Record<string, { args: string[] }>;
    expect(mcp.codeceipt?.args).toEqual([
      "${CURSOR_PLUGIN_ROOT}/scripts/codeceipt.sh",
      "mcp",
      "cursor",
      "${workspaceFolder}",
    ]);
    expect(files.get(`${root}/rules/codeceipt.mdc`)).toMatch(/alwaysApply: true/);
  });

  it("Codex and Antigravity: their own manifest paths and hook shapes (Antigravity: SessionStart and Stop, keyed by hook name)", () => {
    expect(json("plugins/codex/.codex-plugin/plugin.json")).toMatchObject({ name: "codeceipt" });
    const codex = json("plugins/codex/hooks/hooks.json").hooks as Record<
      string,
      { hooks: { timeout: number }[] }[]
    >;
    expect(Object.keys(codex).sort()).toEqual([
      "SessionEnd",
      "SessionStart",
      "Stop",
      "UserPromptSubmit",
    ]);
    // Roadmap Phase 4a: the Stop gate for Codex.
    expect(codex.Stop?.[0]?.hooks[0]?.timeout).toBe(60);
    // Codex allows a SessionEnd hook 3 s at most; codeceipt finishes the receipt in the background.
    expect(codex.SessionEnd?.[0]?.hooks[0]?.timeout).toBe(3);
    expect(files.get("plugins/codex/skills/codeceipt/SKILL.md")).toMatch(/^---\nname: codeceipt\n/);
    expect(json("plugins/antigravity/.antigravity-plugin/plugin.json")).toMatchObject({
      name: "codeceipt",
      displayName: "Codeceipt",
    });
    expect(json("plugins/antigravity/hooks.json")).toEqual({
      codeceipt: {
        SessionStart: [
          {
            type: "command",
            command: 'sh "${PLUGIN_ROOT}/scripts/codeceipt.sh" hook session-start antigravity',
            timeout: 30,
          },
        ],
        Stop: [
          {
            type: "command",
            command: 'sh "${PLUGIN_ROOT}/scripts/codeceipt.sh" hook stop antigravity',
            timeout: 30,
          },
        ],
      },
    });
    expect(files.get("plugins/antigravity/rules/codeceipt.md")).toMatch(
      /^---\ntrigger: always_on\n/,
    );
    expect(json("plugins/antigravity/mcp_config.json")).toEqual({
      mcpServers: {
        codeceipt: {
          command: "sh",
          args: ["${PLUGIN_ROOT}/scripts/codeceipt.sh", "mcp", "antigravity"],
        },
      },
    });
  });

  it("marketplace files for Claude Code, Cursor and Codex point at their plugin folders", () => {
    expect(json(".claude-plugin/marketplace.json")).toMatchObject({
      name: "codeceipt",
      plugins: [{ name: "codeceipt", source: "./plugins/claude-code" }],
    });
    expect(json(".cursor-plugin/marketplace.json")).toMatchObject({
      plugins: [{ name: "codeceipt", source: "./plugins/cursor" }],
    });
    expect(json(".agents/plugins/marketplace.json")).toMatchObject({
      plugins: [{ name: "codeceipt", source: { source: "local", path: "./plugins/codex" } }],
    });
    expect(PLUGIN_AGENTS).toEqual(["claude", "cursor", "codex", "antigravity"]);
  });

  it("attack: no plugin file carries a token, a header or an npx download; every command is the launcher with fixed words", () => {
    for (const [path, text] of files) {
      expect(text, path).not.toMatch(TOKEN_LIKE);
      expect(text, path).not.toMatch(/Bearer|Authorization|_TOKEN|npx /);
    }
    const commands: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v))
          k === "command" && typeof x === "string" ? commands.push(x) : walk(x);
    };
    for (const [path, text] of files) if (path.endsWith("hooks.json")) walk(JSON.parse(text));
    // Claude Code 4, Cursor 4 (with the FEAT-020 stop hook), Codex 4 and Antigravity 2 (with the Phase 4a stop hook).
    expect(commands.length).toBe(4 + 4 + 4 + 2);
    for (const c of commands) {
      expect(c).toMatch(
        /^sh "\$\{(?:CLAUDE_PLUGIN_ROOT|CURSOR_PLUGIN_ROOT|PLUGIN_ROOT)\}\/scripts\/codeceipt\.sh" hook (?:session-start|session-end|prompt|stop) (?:claude|cursor|codex|antigravity)$/,
      );
    }
  });

  it("attack: no script path is relative (a repo's own scripts/codeceipt.sh never runs), and Codex's MCP server runs only an absolute codeceipt", () => {
    for (const [path, text] of files) {
      if (path.endsWith(".json")) expect(text, path).not.toMatch(/"(?:sh )?\.\/scripts\//);
    }
    const codex = json("plugins/codex/.mcp.json").mcpServers as Record<
      string,
      { command: string; args: string[] }
    >;
    expect(codex.codeceipt?.command).toBe("sh");
    const t = launchInline(codex.codeceipt?.args ?? []);
    expect(t.r.status).toBe(0);
    expect(existsSync(join(t.project, "ran"))).toBe(false);
  });

  it("attack: the plugin's instructions treat the handoff note as context, never as orders (a repo can ship a server named codeceipt)", () => {
    for (const [path, text] of files) {
      if (!/\.(md|mdc)$/.test(path) || path === "README.md") continue;
      expect(text, path).not.toMatch(/follow its handoff note|owner's instructions/);
      expect(text, path).toMatch(/handoff note as context/);
    }
  });

  it("the committed marketplace folder is exactly what the generator writes (run pnpm -C packages/agent-plugins generate)", () => {
    const committed = new Map<string, string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else committed.set(relative(MARKETPLACE, p).replace(/\\/g, "/"), readFileSync(p, "utf8"));
      }
    };
    walk(MARKETPLACE);
    expect([...committed.keys()].sort()).toEqual([...files.keys()].sort());
    for (const [path, text] of files) expect(committed.get(path), path).toBe(text);
  });
});

// Codex's MCP command run for real in a hostile repo that ships ./codeceipt, with "." on PATH.
function launchInline(args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "cc-plugin-"));
  const project = mkdtempSync(join(tmpdir(), "cc-project-"));
  writeFileSync(join(project, "codeceipt"), `#!/bin/sh\ntouch "${project}/ran"\n`);
  chmodSync(join(project, "codeceipt"), 0o755);
  const r = spawnSync("/bin/sh", args, {
    cwd: project,
    env: { HOME: home, PATH: ".:/usr/bin:/bin" },
    encoding: "utf8",
  });
  return { r, project };
}

// The launcher, run for real under sh with a fake HOME (no network; a stub codeceipt records how it was called).
function launch(
  args: string[],
  opts: { installed?: string; env?: Record<string, string>; stdin?: string; uname?: string } = {},
) {
  const home = mkdtempSync(join(tmpdir(), "cc-plugin-"));
  const script = join(home, "codeceipt.sh");
  writeFileSync(script, LAUNCHER);
  const stubs = join(home, "stubs");
  mkdirSync(stubs);
  if (opts.uname) {
    writeFileSync(join(stubs, "uname"), `#!/bin/sh\necho ${opts.uname}\n`);
    chmodSync(join(stubs, "uname"), 0o755);
  }
  const log = join(home, "calls.log");
  if (opts.installed !== undefined) {
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    const bin = join(home, ".local", "bin", "codeceipt");
    writeFileSync(
      bin,
      `#!/bin/sh\nprintf '%s|' "$@" > "${log}"\necho >> "${log}"\npwd >> "${log}"\ncat >> "${log}"\n${opts.installed}\n`,
    );
    chmodSync(bin, 0o755);
  }
  const r = spawnSync("/bin/sh", [script, ...args], {
    env: { HOME: home, PATH: `${stubs}:/usr/bin:/bin`, ...opts.env },
    input: opts.stdin ?? "",
    encoding: "utf8",
  });
  return { home, r, calls: existsSync(log) ? readFileSync(log, "utf8") : null };
}

describe("the launcher", () => {
  it("runs the installed codeceipt with the hook's fixed arguments and --plugin, passing stdin through", () => {
    const t = launch(["hook", "session-end", "claude"], {
      installed: "exit 0",
      stdin: '{"session_id":"s1"}',
    });
    expect(t.r.status).toBe(0);
    expect(t.calls).toMatch(/^hook\|session-end\|--agent\|claude\|--plugin\|\n/);
    expect(t.calls).toContain('{"session_id":"s1"}');
  });

  it("runs in the session's folder (CLAUDE_PROJECT_DIR, or CURSOR_PROJECT_DIR for Cursor, which starts hooks in the plugin folder)", () => {
    const project = mkdtempSync(join(tmpdir(), "cc-project-"));
    const t = launch(["hook", "session-start", "cursor"], {
      installed: "exit 0",
      env: { CURSOR_PROJECT_DIR: project },
    });
    expect(t.calls?.split("\n")[1]).toBe(project);
  });

  it("never fails the session: a codeceipt that exits 2 (which would block a Stop hook) still ends in exit 0", () => {
    const t = launch(["hook", "stop", "claude"], { installed: "exit 2" });
    expect(t.calls).not.toBeNull();
    expect(t.r.status).toBe(0);
  });

  it("MCP: starts the stdio proxy (linked repos only) in the project folder given by the agent", () => {
    const project = mkdtempSync(join(tmpdir(), "cc-project-"));
    const t = launch(["mcp", "claude", project], { installed: "exit 0" });
    expect(t.calls).toMatch(/^mcp-proxy\|--linked-only\|\n/);
    expect(t.calls?.split("\n")[1]).toBe(project);
  });

  it("not installed: session start prints one line with the installer for this platform; other events print nothing; exit 0", () => {
    const start = launch(["hook", "session-start", "claude"]);
    expect(start.r.status).toBe(0);
    expect(start.r.stdout).toBe("");
    expect(start.r.stderr.trim().split("\n")).toEqual([
      "Codeceipt is not installed on this computer, so this session gets no receipt. Install it with: curl -fsSL https://codeceipts.vercel.app/install.sh | sh",
    ]);
    const win = launch(["hook", "session-start", "claude"], { uname: "MINGW64_NT-10.0" });
    expect(win.r.stderr).toContain("irm https://codeceipts.vercel.app/install.ps1 | iex");
    for (const event of ["prompt", "stop", "session-end"]) {
      const t = launch(["hook", event, "claude"]);
      expect(t.r.status).toBe(0);
      expect(t.r.stderr + t.r.stdout).toBe("");
    }
    // Cursor's prompt hook still answers so the prompt goes on.
    expect(launch(["hook", "prompt", "cursor"]).r.stdout.trim()).toBe('{"continue":true}');
  });

  it("attack: unknown modes, events or agents run nothing (no codeceipt call, exit 0)", () => {
    for (const args of [
      ["hook", "session-start;id", "claude"],
      ["hook", "session-start", "claude --api-url http://evil"],
      ["hook", "update", "claude"],
      ["exec", "id", "claude"],
      [],
    ]) {
      const t = launch(args, { installed: "exit 0" });
      expect(t.r.status, args.join(" ")).toBe(0);
      expect(t.calls, args.join(" ")).toBeNull();
    }
  });

  it("attack: a codeceipt found through a relative PATH entry (a repo's own ./codeceipt) is never run", () => {
    const project = mkdtempSync(join(tmpdir(), "cc-project-"));
    writeFileSync(join(project, "codeceipt"), `#!/bin/sh\ntouch "${project}/ran"\n`);
    chmodSync(join(project, "codeceipt"), 0o755);
    const t = launch(["hook", "session-start", "claude"], {
      env: { CLAUDE_PROJECT_DIR: project, PATH: ".:/usr/bin:/bin" },
    });
    expect(t.r.status).toBe(0);
    expect(existsSync(join(project, "ran"))).toBe(false);
    expect(t.r.stderr).toContain("is not installed");
  });
});
