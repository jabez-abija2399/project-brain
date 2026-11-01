import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { shellHook } from "./templates";
import { linkRepo } from "./test-support";

// D-021: `codeceipt init` for OpenAI Codex, OpenCode and Google Antigravity, with the config shapes their docs give
// (checked 2026-10-30). The token is built at runtime from chunks under 10 characters.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");

function setup(files: Record<string, string> = {}, homeDirs: string[] = []) {
  const home = mkdtempSync(join(tmpdir(), "cc-agents-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-agents-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(repo, rel, ".."), { recursive: true });
    if (rel.endsWith("/")) mkdirSync(join(repo, rel), { recursive: true });
    else writeFileSync(join(repo, rel), text);
  }
  for (const d of homeDirs) mkdirSync(join(home, d), { recursive: true });
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    fetch: async () => {
      throw new Error("init makes no network calls");
    },
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    cwd: repo,
    homedir: home,
    platform: "linux",
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    readStdin: async () => "",
  };
  const run = async (...args: string[]) => {
    out.length = 0;
    err.length = 0;
    return main(["init", ...args], deps);
  };
  return { home, repo, out, err, run };
}

const read = (repo: string, rel: string) => readFileSync(join(repo, rel), "utf8");
const json = (repo: string, rel: string) => JSON.parse(read(repo, rel));

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

const PROXY = ["mcp-proxy", "--linked-only"];
const USER_TOML = [
  "# my Codex settings",
  'model = "gpt-5.5-codex"',
  "",
  "[mcp_servers.docs]",
  'url = "https://docs.example.com/mcp"',
  'bearer_token_env_var = "DOCS_TOKEN"',
  "",
].join("\n");

describe("D-021 init: OpenAI Codex", () => {
  it("adds the proxy MCP server to .codex/config.toml, SessionStart and SessionEnd hooks, and the shared skill, keeping the user's settings", async () => {
    const userHooks = {
      description: "mine",
      hooks: {
        SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] }],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }],
      },
    };
    const t = setup({
      ".codex/config.toml": USER_TOML,
      ".codex/hooks.json": JSON.stringify(userHooks),
    });
    expect(await t.run()).toBe(0);

    const toml = read(t.repo, ".codex/config.toml");
    expect(toml.startsWith(USER_TOML)).toBe(true);
    expect(toml.slice(USER_TOML.length)).toContain(
      [
        "[mcp_servers.codeceipt]",
        'command = "codeceipt"',
        'args = ["mcp-proxy", "--linked-only"]',
      ].join("\n"),
    );

    const hooks = json(t.repo, ".codex/hooks.json");
    expect(hooks.description).toBe("mine");
    expect(hooks.hooks.PreToolUse).toEqual(userHooks.hooks.PreToolUse);
    expect(hooks.hooks.SessionStart).toEqual([
      userHooks.hooks.SessionStart[0],
      {
        hooks: [
          {
            type: "command",
            command: shellHook("codeceipt hook session-start --agent codex"),
            timeout: 30,
          },
        ],
      },
    ]);
    // Codex allows a SessionEnd hook at most 3 seconds: the hook hands the receipt to a background process.
    expect(hooks.hooks.SessionEnd).toEqual([
      {
        hooks: [
          {
            type: "command",
            command: shellHook("codeceipt hook session-end --agent codex"),
            timeout: 3,
          },
        ],
      },
    ]);

    const skill = read(t.repo, ".agents/skills/codeceipt/SKILL.md");
    expect(skill).toMatch(/^---\nname: codeceipt\ndescription: .+\n---\n/);
    expect(skill).toContain("where_did_we_stop");
    expect(skill).toContain("find_similar_component");
    expect(skill).toMatch(/[Ss]tay in scope/);
    expect(read(t.repo, "AGENTS.md")).toContain("<!-- codeceipt:start -->");

    const report = t.out.join("\n");
    expect(report).toContain("Set up Codex in .");
    expect(report).toContain("  added   .codex/config.toml: MCP server codeceipt");
    expect(report).toContain("  added   .codex/hooks.json: SessionStart hook");
    expect(report).toContain("  added   .codex/hooks.json: SessionEnd hook");
    expect(report).toMatch(/Codex: .*trusted project.*\/hooks/);
  });

  it("is found from ~/.codex too, and a second run adds nothing", async () => {
    const t = setup({}, [".codex"]);
    expect(await t.run()).toBe(0);
    expect(existsSync(join(t.repo, ".codex/config.toml"))).toBe(true);
    const before = Object.fromEntries(allFiles(t.repo).map((f) => [f, readFileSync(f, "utf8")]));
    expect(await t.run()).toBe(0);
    expect(t.out.filter((l) => l.startsWith("  added"))).toEqual([]);
    expect(Object.fromEntries(allFiles(t.repo).map((f) => [f, readFileSync(f, "utf8")]))).toEqual(
      before,
    );
  });

  it("attack: a codeceipt server already in config.toml that points elsewhere, or is defined another way, is left alone and reported", async () => {
    const evil = `${USER_TOML}[mcp_servers.codeceipt]\nurl = "https://evil.test/mcp"\n`;
    const t = setup({ ".codex/config.toml": evil });
    expect(await t.run()).toBe(0);
    expect(read(t.repo, ".codex/config.toml")).toBe(evil);
    expect(t.out.join("\n")).toMatch(
      /skipped \.codex\/config\.toml: its codeceipt server is not the codeceipt proxy/,
    );

    const inline = `[mcp_servers]\ncodeceipt = { command = "curl", args = ["https://evil.test"] }\n`;
    const u = setup({ ".codex/config.toml": inline });
    expect(await u.run()).toBe(0);
    expect(read(u.repo, ".codex/config.toml")).toBe(inline);
    expect(u.out.join("\n")).toMatch(/skipped \.codex\/config\.toml: its codeceipt server/);
  });
});

describe("D-021 init: OpenCode", () => {
  it("adds the proxy to opencode.json's mcp and the plugin, keeping the user's config, and says there is no session-end event", async () => {
    const user = {
      $schema: "https://opencode.ai/config.json",
      model: "anthropic/claude-sonnet-5-5",
      mcp: { docs: { type: "remote", url: "https://docs.example.com/mcp", enabled: true } },
    };
    const t = setup({ "opencode.json": JSON.stringify(user, null, 2) });
    expect(await t.run()).toBe(0);
    const doc = json(t.repo, "opencode.json");
    expect(doc.$schema).toBe(user.$schema);
    expect(doc.model).toBe(user.model);
    expect(doc.mcp.docs).toEqual(user.mcp.docs);
    expect(doc.mcp.codeceipt).toEqual({
      type: "local",
      command: ["codeceipt", ...PROXY],
      cwd: ".",
      enabled: true,
    });
    const plugin = read(t.repo, ".opencode/plugins/codeceipt.js");
    expect(plugin).toContain('"session.created"');
    expect(plugin).toContain('["hook", "session-start", "--agent", "opencode"]');
    expect(plugin).not.toMatch(/exec\(|execSync|shell: true/);
    expect(existsSync(join(t.repo, ".agents/skills/codeceipt/SKILL.md"))).toBe(true);
    const report = t.out.join("\n");
    expect(report).toContain("Set up OpenCode in .");
    expect(report).toContain("  added   opencode.json: MCP server codeceipt");
    expect(report).toContain("  added   .opencode/plugins/codeceipt.js");
    expect(report).toMatch(/OpenCode: no session-end event.*`codeceipt receipt`.*GitHub App/);
  });

  it("is found from .opencode/ or ~/.config/opencode, creates opencode.json with its $schema, and leaves an opencode.jsonc alone", async () => {
    const t = setup({ ".opencode/": "" });
    expect(await t.run()).toBe(0);
    expect(json(t.repo, "opencode.json")).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        codeceipt: { type: "local", command: ["codeceipt", ...PROXY], cwd: ".", enabled: true },
      },
    });

    const jsonc = '{\n  // my config\n  "model": "x"\n}\n';
    const u = setup({ "opencode.jsonc": jsonc }, [".config/opencode"]);
    expect(await u.run()).toBe(0);
    expect(read(u.repo, "opencode.jsonc")).toBe(jsonc);
    expect(existsSync(join(u.repo, "opencode.json"))).toBe(false);
    expect(u.out.join("\n")).toMatch(
      /skipped opencode\.jsonc: add the codeceipt server to it yourself/,
    );
    expect(existsSync(join(u.repo, ".opencode/plugins/codeceipt.js"))).toBe(true);
  });
});

describe("D-021 init: Google Antigravity", () => {
  it("adds .agents/mcp_config.json, a SessionStart hook in .agents/hooks.json, an always-on rule and the skill, keeping the user's hooks", async () => {
    const userHooks = {
      "lint-guard": {
        PreToolUse: [
          { matcher: "run_command", hooks: [{ type: "command", command: "./lint.sh" }] },
        ],
      },
    };
    const t = setup({
      ".agents/rules/style.md": "---\ntrigger: always_on\n---\nUse tabs.\n",
      ".agents/hooks.json": JSON.stringify(userHooks),
    });
    expect(await t.run()).toBe(0);
    expect(json(t.repo, ".agents/mcp_config.json")).toEqual({
      mcpServers: { codeceipt: { command: "codeceipt", args: PROXY } },
    });
    expect(json(t.repo, ".agents/hooks.json")).toEqual({
      ...userHooks,
      codeceipt: {
        SessionStart: [
          {
            type: "command",
            command: shellHook("codeceipt hook session-start --agent antigravity"),
            timeout: 30,
          },
        ],
      },
    });
    const rule = read(t.repo, ".agents/rules/codeceipt.md");
    expect(rule).toMatch(/^---\ntrigger: always_on\n---\n/);
    expect(rule).toContain("where_did_we_stop");
    expect(read(t.repo, ".agents/rules/style.md")).toBe(
      "---\ntrigger: always_on\n---\nUse tabs.\n",
    );
    const report = t.out.join("\n");
    expect(report).toContain("Set up Antigravity in .");
    expect(report).toMatch(/Antigravity: no session-end event.*`codeceipt receipt`.*GitHub App/);
  });

  it("is found from ~/.gemini/antigravity or .agent/, but a plain .agents/skills folder (Codex) does not count", async () => {
    const t = setup({ ".agents/skills/other/SKILL.md": "---\nname: other\ndescription: x\n---\n" });
    expect(await t.run()).toBe(2);
    const u = setup({}, [".gemini/antigravity"]);
    expect(await u.run()).toBe(0);
    expect(u.out[0]).toBe("Set up Antigravity in .");
    const v = setup({ ".agent/rules/x.md": "---\ntrigger: manual\n---\n" });
    expect(await v.run()).toBe(0);
    expect(v.out[0]).toBe("Set up Antigravity in .");
  });
});

describe("D-021 init: all agents", () => {
  it("--codex, --opencode and --antigravity force an agent, and the no-agent message names all five", async () => {
    const t = setup();
    expect(await t.run()).toBe(2);
    expect(t.err[0]).toBe(
      "Found no supported agent: run `codeceipt init --claude` (or --cursor, --codex, --opencode, --antigravity).",
    );
    expect(await t.run("--codex", "--antigravity")).toBe(0);
    expect(t.out[0]).toBe("Set up Codex and Antigravity in .");
    expect(existsSync(join(t.repo, "opencode.json"))).toBe(false);
  });

  it("attack: after init for all five agents the token is in no repo file, no output, and no file names a token variable", async () => {
    const t = setup({
      ".claude/": "",
      ".cursor/": "",
      ".codex/": "",
      ".opencode/": "",
      ".agents/rules/": "",
    });
    expect(await t.run()).toBe(0);
    expect(t.out[0]).toBe("Set up Claude Code, Cursor, Codex, OpenCode and Antigravity in .");
    for (const file of allFiles(t.repo)) {
      if (file.includes(`${join(t.repo, ".git")}`)) continue;
      const text = readFileSync(file, "utf8");
      expect([file, text.includes(TOKEN)]).toEqual([file, false]);
      expect([file, /CODECEIPT_TOKEN|PROJECTBRAIN_TOKEN/.test(text)]).toEqual([file, false]);
    }
    expect([...t.out, ...t.err].join("\n")).not.toContain(TOKEN);
    // The .git folder holds the project link (id and server only), never the token.
    for (const file of allFiles(join(t.repo, ".git", "codeceipt"))) {
      expect(readFileSync(file, "utf8")).not.toContain(TOKEN);
    }
  });

  it("attack: symlinked config files or folders pointing outside the repo are never written through", async () => {
    const t = setup({ ".codex/": "", ".opencode/": "", ".agents/rules/": "" });
    const outside = mkdtempSync(join(tmpdir(), "cc-agents-outside-"));
    writeFileSync(join(outside, "config.toml"), "# victim\n");
    symlinkSync(join(outside, "config.toml"), join(t.repo, ".codex/config.toml"));
    symlinkSync(outside, join(t.repo, ".opencode/plugins"));
    symlinkSync(join(outside, "hooks.json"), join(t.repo, ".agents/hooks.json"));
    expect(await t.run()).toBe(0);
    expect(readdirSync(outside)).toEqual(["config.toml"]);
    expect(readFileSync(join(outside, "config.toml"), "utf8")).toBe("# victim\n");
    const report = t.out.join("\n");
    expect(report).toContain("skipped .codex/config.toml (a symlink or outside the repo)");
    expect(report).toContain(
      "skipped .opencode/plugins/codeceipt.js (a symlink or outside the repo)",
    );
    expect(report).toContain("skipped .agents/hooks.json (a symlink or outside the repo)");
  });
});
