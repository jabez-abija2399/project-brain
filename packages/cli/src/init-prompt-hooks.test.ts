import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { OPENCODE_PLUGIN } from "./templates";
import { linkRepo } from "./test-support";

// init installs each agent's prompt-submit hook, so requests are recorded without the agent having to remember.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");

function setup(dirs: string[]) {
  const home = mkdtempSync(join(tmpdir(), "cc-ph-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-ph-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  for (const d of dirs) mkdirSync(join(repo, d), { recursive: true });
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const out: string[] = [];
  const deps: CliDeps = {
    fetch: async () => {
      throw new Error("no network");
    },
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    cwd: repo,
    homedir: home,
    platform: "linux",
    stdout: (l) => out.push(l),
    stderr: () => {},
    readStdin: async () => "",
  };
  return { repo, out, run: () => main(["init"], deps) };
}
const json = (repo: string, rel: string) => JSON.parse(readFileSync(join(repo, rel), "utf8"));

describe("init installs prompt-submit hooks", () => {
  it("Claude Code UserPromptSubmit, Cursor beforeSubmitPrompt and Codex UserPromptSubmit", async () => {
    const t = setup([".claude", ".cursor", ".codex"]);
    expect(await t.run()).toBe(0);
    expect(json(t.repo, ".claude/settings.json").hooks.UserPromptSubmit).toEqual([
      {
        hooks: [{ type: "command", command: "codeceipt hook prompt --agent claude", timeout: 10 }],
      },
    ]);
    expect(json(t.repo, ".cursor/hooks.json").hooks.beforeSubmitPrompt).toEqual([
      { command: "codeceipt hook prompt --agent cursor", timeout: 10 },
    ]);
    expect(json(t.repo, ".codex/hooks.json").hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: "command", command: "codeceipt hook prompt --agent codex", timeout: 10 }] },
    ]);
    const report = t.out.join("\n");
    expect(report).toContain("  added   .claude/settings.json: UserPromptSubmit hook");
    expect(report).toContain("  added   .cursor/hooks.json: beforeSubmitPrompt hook");
    expect(report).toContain("  added   .codex/hooks.json: UserPromptSubmit hook");
    // A second run adds nothing.
    t.out.length = 0;
    expect(await t.run()).toBe(0);
    expect(t.out.filter((l) => l.startsWith("  added"))).toEqual([]);
  });

  it("the OpenCode plugin records each user message through chat.message, without changing it", () => {
    expect(OPENCODE_PLUGIN).toContain('"chat.message"');
    expect(OPENCODE_PLUGIN).toContain('["hook", "prompt", "--agent", "opencode"]');
    expect(OPENCODE_PLUGIN).not.toMatch(/output\.(parts|message)\s*=|output\.parts\.(push|splice)/);
  });

  it("Antigravity has no documented prompt event: init says the agent records requests itself", async () => {
    const t = setup([".agents/rules"]);
    expect(await t.run()).toBe(0);
    expect(t.out.join("\n")).toMatch(/Antigravity: .*no prompt-submit event.*create_checklist/);
  });
});
