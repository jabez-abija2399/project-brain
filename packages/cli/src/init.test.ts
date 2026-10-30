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
import { writeConfig } from "./config";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// The token is built at runtime from chunks under 10 characters.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");

function setup(agentDirs: string[] = [".claude", ".cursor"]) {
  const home = mkdtempSync(join(tmpdir(), "pb-init-home-"));
  const repo = mkdtempSync(join(tmpdir(), "pb-init-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  for (const d of agentDirs) mkdirSync(join(repo, d), { recursive: true });
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

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

describe("FEAT-016 codeceipt init", () => {
  it("AC-016-01 detects Claude Code and Cursor and writes the MCP config, Skill, rule, hooks and an AGENTS.md section for each", async () => {
    const t = setup();
    expect(await t.run()).toBe(0);
    expect(readJson(join(t.repo, ".mcp.json")).mcpServers.codeceipt).toEqual({
      type: "http",
      url: "https://brain.test/mcp",
      headersHelper: "codeceipt mcp-headers",
    });
    // Launch part 3: Cursor runs the CLI's stdio proxy, so no token variable is needed.
    expect(readJson(join(t.repo, ".cursor/mcp.json")).mcpServers.codeceipt).toEqual({
      command: "codeceipt",
      args: ["mcp-proxy", "--repo", "${workspaceFolder}"],
    });
    const claude = readJson(join(t.repo, ".claude/settings.json")).hooks;
    expect(claude.SessionStart[0].hooks[0]).toMatchObject({
      type: "command",
      command: "codeceipt hook session-start --agent claude",
    });
    expect(claude.SessionEnd[0].hooks[0]).toMatchObject({
      command: "codeceipt hook session-end --agent claude",
      timeout: 60,
    });
    expect(readJson(join(t.repo, ".cursor/hooks.json"))).toMatchObject({
      version: 1,
      hooks: {
        sessionStart: [{ command: "codeceipt hook session-start --agent cursor" }],
        sessionEnd: [{ command: "codeceipt hook session-end --agent cursor" }],
      },
    });
    expect(readFileSync(join(t.repo, ".claude/skills/codeceipt/SKILL.md"), "utf8")).toContain(
      "name: codeceipt",
    );
    expect(readFileSync(join(t.repo, "AGENTS.md"), "utf8")).toContain("## Codeceipt");
    expect(t.out[0]).toBe("Set up Claude Code and Cursor in .");
    expect(t.out).toContain("  added   .mcp.json: MCP server codeceipt");
    expect(t.out).toContain("  added   AGENTS.md section");
  });

  it("AC-016-01 attack: the project token is in no file of the repo after init, and init never prints it", async () => {
    const t = setup();
    await t.run();
    const files = allFiles(t.repo).filter((f) => !f.includes(`${join(t.repo, ".git")}/`));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const file of allFiles(t.repo)) {
      expect(readFileSync(file).includes(TOKEN), file).toBe(false);
    }
    expect([...t.out, ...t.err].join("\n")).not.toContain(TOKEN);
  });

  it("AC-016-04 running init twice adds nothing: no duplicate servers, hooks or AGENTS.md sections", async () => {
    const t = setup();
    await t.run();
    const snapshot = Object.fromEntries(allFiles(t.repo).map((f) => [f, readFileSync(f, "utf8")]));
    expect(await t.run()).toBe(0);
    expect(t.out.filter((l) => l.includes("added"))).toEqual([]);
    expect(t.out).toContain("  kept    AGENTS.md section (already set up)");
    for (const [file, text] of Object.entries(snapshot))
      expect(readFileSync(file, "utf8")).toBe(text);
    expect(readFileSync(join(t.repo, "AGENTS.md"), "utf8").split("## Codeceipt")).toHaveLength(2);
  });

  it("AC-016-05 never overwrites the user's AGENTS.md content, hooks or MCP servers, and prints what it added", async () => {
    const t = setup([".claude"]);
    writeFileSync(join(t.repo, "AGENTS.md"), "# My rules\nAlways write tests.");
    const userHook = { hooks: [{ type: "command", command: "echo hello" }] };
    writeFileSync(
      join(t.repo, ".claude/settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, hooks: { SessionStart: [userHook] } }),
    );
    writeFileSync(
      join(t.repo, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { url: "https://x.test" } } }),
    );
    expect(await t.run()).toBe(0);
    expect(readFileSync(join(t.repo, "AGENTS.md"), "utf8")).toMatch(
      /^# My rules\nAlways write tests\.\n\n<!-- codeceipt:start -->/,
    );
    const settings = readJson(join(t.repo, ".claude/settings.json"));
    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
    expect(settings.hooks.SessionStart[0]).toEqual(userHook);
    expect(settings.hooks.SessionStart).toHaveLength(2);
    expect(Object.keys(readJson(join(t.repo, ".mcp.json")).mcpServers)).toEqual([
      "other",
      "codeceipt",
    ]);
    expect(t.out).toEqual(
      expect.arrayContaining([
        "  added   .claude/settings.json: SessionStart hook",
        "  added   .claude/settings.json: SessionEnd hook",
      ]),
    );
    // A file that is not valid JSON is left as it is.
    mkdirSync(join(t.repo, ".cursor"));
    writeFileSync(join(t.repo, ".cursor/hooks.json"), "{ not json");
    await t.run("--cursor");
    expect(readFileSync(join(t.repo, ".cursor/hooks.json"), "utf8")).toBe("{ not json");
    expect(t.out).toContain("  skipped .cursor/hooks.json (not valid JSON; left unchanged)");
  });

  it("AC-016-05 attack: a symlinked AGENTS.md or config pointing outside the repo is not written through", async () => {
    const t = setup([".claude"]);
    const outside = join(t.home, "profile.txt");
    writeFileSync(outside, "export PATH=/usr/bin\n");
    symlinkSync(outside, join(t.repo, "AGENTS.md"));
    symlinkSync(t.home, join(t.repo, ".claude/skills"));
    await t.run();
    expect(readFileSync(outside, "utf8")).toBe("export PATH=/usr/bin\n");
    expect(existsSync(join(t.home, "codeceipt"))).toBe(false);
    expect(t.out).toEqual(
      expect.arrayContaining([
        "  skipped AGENTS.md (a symlink or outside the repo)",
        "  skipped .claude/skills/codeceipt/SKILL.md (a symlink or outside the repo)",
      ]),
    );
  });

  it("finds no agent without .claude or .cursor (exit 2), and needs a login first (exit 3)", async () => {
    const t = setup([]);
    expect(await t.run()).toBe(2);
    expect(t.err[0]).toMatch(/codeceipt init --claude/);
    rmConfig(t.home);
    expect(await t.run("--claude")).toBe(3);
  });
});

function rmConfig(home: string) {
  writeFileSync(join(home, ".config", "codeceipt", "config.json"), "{}");
}
