import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build.mjs";
import { writeConfig } from "./config";
import { type CliDeps, helpText, main } from "./index";
import { writeRepoLink } from "./repo-link";
import {
  AGENTS_START,
  CLAUDE_SKILL,
  CURSOR_RULE,
  LEGACY_AGENTS_END,
  LEGACY_AGENTS_START,
  LEGACY_CLAUDE_SKILL,
  LEGACY_CURSOR_RULE,
} from "./templates";
import { linkRepo } from "./test-support";

// D-019: the product was renamed from Project Brain to Codeceipt. Existing setups keep working and are upgraded.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");
const API = "https://brain.test";

function world(env: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), "cc-rename-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-rename-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    fetch: async () =>
      new Response(JSON.stringify({ project_id: "proj-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), ...env },
    cwd: repo,
    homedir: home,
    platform: "linux",
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    readStdin: async () => "",
  };
  const run = (...argv: string[]) => {
    out.length = 0;
    err.length = 0;
    return main(argv, deps);
  };
  return { home, repo, out, err, run, deps };
}

const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const OLD_SECTION = `${LEGACY_AGENTS_START}\n## Project Brain\nold workflow\n${LEGACY_AGENTS_END}`;

// What an older `projectbrain init` left in a repo.
function oldSetup(repo: string) {
  write(
    join(repo, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        projectbrain: {
          type: "http",
          url: `${API}/mcp`,
          headers: { Authorization: "Bearer ${PROJECTBRAIN_TOKEN}" },
          headersHelper: "projectbrain mcp-headers",
        },
        other: { url: "https://other.test/mcp" },
      },
    }),
  );
  write(
    join(repo, ".claude/settings.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "projectbrain hook session-start --agent claude",
                timeout: 45,
              },
            ],
          },
        ],
        SessionEnd: [
          {
            hooks: [
              {
                type: "command",
                command: "/usr/local/bin/projectbrain hook session-end --agent claude",
                timeout: 60,
              },
            ],
          },
        ],
      },
    }),
  );
  write(join(repo, ".claude/skills/projectbrain/SKILL.md"), LEGACY_CLAUDE_SKILL);
  write(
    join(repo, ".cursor/mcp.json"),
    JSON.stringify({
      mcpServers: {
        projectbrain: {
          url: `${API}/mcp`,
          headers: { Authorization: "Bearer ${env:PROJECTBRAIN_TOKEN}" },
        },
      },
    }),
  );
  write(
    join(repo, ".cursor/hooks.json"),
    JSON.stringify({
      version: 1,
      hooks: {
        sessionStart: [{ command: "projectbrain hook session-start --agent cursor", timeout: 30 }],
        sessionEnd: [{ command: "projectbrain hook session-end --agent cursor", timeout: 60 }],
      },
    }),
  );
  write(join(repo, ".cursor/rules/projectbrain.mdc"), LEGACY_CURSOR_RULE);
  write(join(repo, "AGENTS.md"), `# My app\n\n${OLD_SECTION}\n\nMy own notes stay.\n`);
}

describe("D-019 rename to Codeceipt", () => {
  it("init upgrades a Project Brain setup in place: no duplicates, user settings kept", async () => {
    const t = world();
    linkRepo(t.repo, join(t.home, ".config", "codeceipt", "config.json"), {
      apiUrl: API,
      projectId: "proj-1",
      token: TOKEN,
    });
    oldSetup(t.repo);
    expect(await t.run("init")).toBe(0);

    const claude = json(join(t.repo, ".mcp.json")).mcpServers;
    expect(Object.keys(claude).sort()).toEqual(["codeceipt", "other"]);
    // Renamed, and (launch part 3) no longer reading a token variable: the CLI helper gives the token.
    expect(claude.codeceipt).toEqual({
      type: "http",
      url: `${API}/mcp`,
      headersHelper: "codeceipt mcp-headers",
    });
    const hooks = json(join(t.repo, ".claude/settings.json")).hooks;
    expect(hooks.SessionStart).toEqual([
      {
        hooks: [
          { type: "command", command: "codeceipt hook session-start --agent claude", timeout: 45 },
        ],
      },
    ]);
    expect(hooks.SessionEnd).toHaveLength(1);
    expect(hooks.SessionEnd[0].hooks[0].command).toBe("codeceipt hook session-end --agent claude");
    expect(readFileSync(join(t.repo, ".claude/skills/codeceipt/SKILL.md"), "utf8")).toBe(
      CLAUDE_SKILL,
    );
    expect(existsSync(join(t.repo, ".claude/skills/projectbrain"))).toBe(false);

    const cursor = json(join(t.repo, ".cursor/mcp.json")).mcpServers;
    expect(Object.keys(cursor)).toEqual(["codeceipt"]);
    // Launch part 3: the upgraded entries need no token variable (Cursor runs the CLI's proxy).
    expect(cursor.codeceipt).toEqual({
      command: "codeceipt",
      args: ["mcp-proxy", "--repo", "${workspaceFolder}"],
    });
    const cursorHooks = json(join(t.repo, ".cursor/hooks.json")).hooks;
    expect(cursorHooks.sessionStart).toEqual([
      { command: "codeceipt hook session-start --agent cursor", timeout: 30 },
    ]);
    expect(cursorHooks.sessionEnd).toHaveLength(1);
    expect(readFileSync(join(t.repo, ".cursor/rules/codeceipt.mdc"), "utf8")).toBe(CURSOR_RULE);
    expect(existsSync(join(t.repo, ".cursor/rules/projectbrain.mdc"))).toBe(false);

    const agents = readFileSync(join(t.repo, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# My app\n\n<!-- codeceipt:start -->\n## Codeceipt\n")).toBe(true);
    expect(agents.endsWith("<!-- codeceipt:end -->\n\nMy own notes stay.\n")).toBe(true);
    expect(agents).not.toContain("projectbrain");
    expect(agents.split(AGENTS_START)).toHaveLength(2);

    // A second run finds everything in place.
    expect(await t.run("init")).toBe(0);
    expect(t.out.filter((l) => l.startsWith("  added"))).toEqual([]);
  });

  it("init leaves an edited Project Brain Skill alone (and adds no second one), and a foreign projectbrain server is reported", async () => {
    const t = world();
    linkRepo(t.repo, join(t.home, ".config", "codeceipt", "config.json"), {
      apiUrl: API,
      projectId: "proj-1",
      token: TOKEN,
    });
    write(
      join(t.repo, ".claude/skills/projectbrain/SKILL.md"),
      `${LEGACY_CLAUDE_SKILL}\nMy rule.\n`,
    );
    write(
      join(t.repo, ".mcp.json"),
      JSON.stringify({ mcpServers: { projectbrain: { url: "https://evil.test/mcp" } } }),
    );
    expect(await t.run("init", "--claude")).toBe(0);
    expect(readFileSync(join(t.repo, ".claude/skills/projectbrain/SKILL.md"), "utf8")).toContain(
      "My rule.",
    );
    expect(existsSync(join(t.repo, ".claude/skills/codeceipt/SKILL.md"))).toBe(false);
    const servers = json(join(t.repo, ".mcp.json")).mcpServers;
    expect(servers.projectbrain).toEqual({ url: "https://evil.test/mcp" });
    expect(servers.codeceipt.url).toBe(`${API}/mcp`);
    expect(t.out.join("\n")).toContain(
      ".claude/skills/projectbrain/SKILL.md (changed by you; rename it to .claude/skills/codeceipt/SKILL.md yourself)",
    );
    expect(t.out.join("\n")).toContain("its projectbrain server points at another address");
  });

  it("login takes CODECEIPT_TOKEN, still accepts PROJECTBRAIN_TOKEN, and saves to the codeceipt config folder", async () => {
    const old = world({ PROJECTBRAIN_TOKEN: TOKEN });
    expect(await old.run("login", "--api-url", API)).toBe(0);
    // In a git repo the login is kept per project (D-020).
    expect(json(join(old.home, ".config", "codeceipt", "config.json")).projects[0].token).toBe(
      TOKEN,
    );
    const newer = ["cc_", "new", "Z8yW1", "qL4"].join("");
    const both = world({ PROJECTBRAIN_TOKEN: TOKEN, CODECEIPT_TOKEN: newer });
    expect(await both.run("login", "--api-url", API)).toBe(0);
    expect(json(join(both.home, ".config", "codeceipt", "config.json")).projects[0].token).toBe(
      newer,
    );
  });

  it("a login saved under the old projectbrain config folder still works until the next login", async () => {
    const t = world({ CLAUDE_CODE_MCP_SERVER_URL: `${API}/mcp` });
    writeConfig(join(t.home, ".config", "projectbrain", "config.json"), {
      apiUrl: API,
      projectId: "proj-1",
      token: TOKEN,
    });
    // D-020: the repo names its project; the token for it may still be in the old folder.
    writeRepoLink(join(t.repo, ".git"), { apiUrl: API, projectId: "proj-1" });
    expect(await t.run("mcp-headers")).toBe(0);
    expect(t.out).toEqual([JSON.stringify({ Authorization: `Bearer ${TOKEN}` })]);
  });

  it("the help text and messages use the new name", async () => {
    expect(helpText()).toContain("codeceipt login");
    expect(helpText()).toContain("A receipt for every AI change.");
    expect(helpText()).not.toMatch(/projectbrain|Project Brain/);
    const t = world();
    expect(await t.run("index")).toBe(3);
    // D-020: in a git repo without a project link, the CLI says how to link it.
    expect(t.err).toEqual([
      "This repo is not linked to a Codeceipt project: run `npx codeceipt` here.",
    ]);
  });

  it("the build publishes as the npm package codeceipt, keeping projectbrain as a second command", async () => {
    const pkgDir = fileURLToPath(new URL("..", import.meta.url));
    const outDir = mkdtempSync(join(pkgDir, ".rename-build-"));
    try {
      const bin = await build({ outDir });
      expect(bin).toBe(join(outDir, "codeceipt.mjs"));
      const manifest = json(join(outDir, "package.json"));
      expect(manifest).toMatchObject({
        name: "codeceipt",
        description: "A receipt for every AI change.",
        bin: { codeceipt: "./codeceipt.mjs", projectbrain: "./codeceipt.mjs" },
      });
      expect(Object.keys(manifest.dependencies).sort()).toEqual(
        ["@electric-sql/pglite", "ignore", "libpg-query", "typescript"].sort(),
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, 60_000);
});
