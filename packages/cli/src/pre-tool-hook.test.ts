import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPath } from "./config";
import { PRE_TOOL_INPUT_TOO_LARGE } from "./hook-input";
import { type CliDeps, main } from "./index";
import { writeBoundaryCache } from "./repo-link";
import { linkRepo } from "./test-support";

// Roadmap Phase 5b: `codeceipt hook pre-tool` blocks protected paths before the agent writes them.
const PROJECT = "11111111-2222-3333-4444-555555555555";

function setup(boundaries = [{ kind: "protected_path", pattern: "supabase/migrations/**" }]) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "cc-pretool-")));
  const home = mkdtempSync(join(tmpdir(), "cc-home-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  writeFileSync(join(repo, "README.md"), "# app\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const configFile = configPath({ XDG_CONFIG_HOME: join(home, ".config") }, "linux", home);
  linkRepo(repo, configFile, {
    apiUrl: "https://codeceipt.example",
    projectId: PROJECT,
    token: ["pb", "_", "testtoken123"].join(""),
  });
  writeBoundaryCache(join(repo, ".git"), PROJECT, boundaries);
  const run = async (agent: string, input: object | string, argv: string[] = []) => {
    const out: string[] = [];
    const code = await main(["hook", "pre-tool", "--agent", agent, ...argv], {
      fetch: async () => {
        throw new Error("the pre-tool hook must not use the network");
      },
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: () => {},
      readStdin: async () => (typeof input === "string" ? input : JSON.stringify(input)),
    } satisfies CliDeps);
    return { code, out };
  };
  return { repo, home, configFile, run };
}

describe("codeceipt hook pre-tool (roadmap Phase 5b)", () => {
  it("PH5B-06 Claude Code: a write under a protected path is denied, other writes say nothing", async () => {
    const { repo, run } = setup();
    const denied = await run("claude", {
      tool_name: "Write",
      cwd: repo,
      tool_input: { file_path: join(repo, "supabase/migrations/03.sql") },
    });
    expect(denied.code).toBe(0);
    const answer = JSON.parse(denied.out.join("\n"));
    expect(answer.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(answer.hookSpecificOutput.permissionDecisionReason).toContain(
      "supabase/migrations/03.sql",
    );
    const allowed = await run("claude", {
      tool_name: "Edit",
      cwd: repo,
      tool_input: { file_path: join(repo, "src/app.ts") },
    });
    expect(allowed.out).toEqual([]);
  });

  it("PH5B-07 Cursor, Codex (apply_patch) and Antigravity each get their own deny", async () => {
    const { repo, run } = setup();
    const cursor = await run("cursor", {
      tool_name: "edit_file",
      tool_input: { target_file: "supabase/migrations/1.sql" },
      cwd: repo,
    });
    expect(JSON.parse(cursor.out[0] ?? "{}").permission).toBe("deny");
    const patch =
      "*** Begin Patch\n*** Add File: supabase/migrations/2.sql\n+select 1;\n*** End Patch";
    const codex = await run("codex", {
      tool_name: "apply_patch",
      cwd: repo,
      tool_input: { command: ["apply_patch", patch] },
    });
    expect(JSON.parse(codex.out[0] ?? "{}").hookSpecificOutput.permissionDecision).toBe("deny");
    const antigravity = await run("antigravity", {
      cwd: repo,
      toolCall: { args: { TargetFile: join(repo, "supabase/migrations/3.sql") } },
    });
    expect(JSON.parse(antigravity.out[0] ?? "{}").decision).toBe("deny");
  });

  it("PH5B-08 gentle asks instead of denying; off and no boundaries say nothing", async () => {
    const write = (repo: string) => ({
      tool_name: "Write",
      cwd: repo,
      tool_input: { file_path: join(repo, "supabase/migrations/03.sql") },
    });
    const gentle = setup();
    await main(["config", "guard", "gentle"], {
      fetch: async () => new Response(""),
      env: { HOME: gentle.home, XDG_CONFIG_HOME: join(gentle.home, ".config") },
      cwd: gentle.repo,
      homedir: gentle.home,
      platform: "linux",
      stdout: () => {},
      stderr: () => {},
      readStdin: async () => "",
    });
    const asked = await gentle.run("claude", write(gentle.repo));
    expect(JSON.parse(asked.out[0] ?? "{}").hookSpecificOutput.permissionDecision).toBe("ask");
    const none = setup([]);
    expect((await none.run("claude", write(none.repo))).out).toEqual([]);
    await main(["config", "guard", "off"], {
      fetch: async () => new Response(""),
      env: { HOME: gentle.home, XDG_CONFIG_HOME: join(gentle.home, ".config") },
      cwd: gentle.repo,
      homedir: gentle.home,
      platform: "linux",
      stdout: () => {},
      stderr: () => {},
      readStdin: async () => "",
    });
    expect((await gentle.run("claude", write(gentle.repo))).out).toEqual([]);
  });

  it("PH5B-09 attack: a path that climbs out with .. or names another folder cannot dodge or misfire the check", async () => {
    const { repo, run } = setup();
    const climbed = await run("claude", {
      tool_name: "Write",
      cwd: repo,
      tool_input: { file_path: join(repo, "src/../supabase/migrations/x.sql") },
    });
    expect(JSON.parse(climbed.out[0] ?? "{}").hookSpecificOutput.permissionDecision).toBe("deny");
    const outside = await run("claude", {
      tool_name: "Write",
      cwd: repo,
      tool_input: { file_path: "/tmp/elsewhere/supabase/migrations/x.sql" },
    });
    expect(outside.out).toEqual([]);
    const garbage = await run("claude", { tool_name: "Write", tool_input: "not an object" });
    expect(garbage).toEqual({ code: 0, out: [] });
  });

  it("PH5B-10 the hook answers in under 200 ms, without the network", async () => {
    const { repo, run } = setup();
    const input = {
      tool_name: "Write",
      cwd: repo,
      tool_input: { file_path: join(repo, "supabase/migrations/03.sql") },
    };
    await run("claude", input);
    const t0 = performance.now();
    const res = await run("claude", input);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(res.out.length).toBe(1);
  });

  it("PH5B-14 attack (security review): a symlinked folder, an edit too large to read and the settings file are refused", async () => {
    const { repo, configFile, run } = setup();
    mkdirSync(join(repo, "supabase/migrations"), { recursive: true });
    symlinkSync(join(repo, "supabase"), join(repo, "db"));
    const viaLink = await run("claude", {
      tool_name: "Write",
      cwd: repo,
      tool_input: { file_path: join(repo, "db/migrations/x.sql") },
    });
    expect(JSON.parse(viaLink.out[0] ?? "{}").hookSpecificOutput.permissionDecision).toBe("deny");
    const tooLarge = await run("claude", PRE_TOOL_INPUT_TOO_LARGE);
    expect(
      JSON.parse(tooLarge.out[0] ?? "{}").hookSpecificOutput.permissionDecisionReason,
    ).toContain("too large to check");
    const settings = await run("claude", {
      tool_name: "Write",
      cwd: repo,
      tool_input: { file_path: configFile },
    });
    expect(JSON.parse(settings.out[0] ?? "{}").hookSpecificOutput.permissionDecision).toBe("deny");
    const cache = await run("claude", {
      tool_name: "Write",
      cwd: repo,
      tool_input: { file_path: join(repo, ".git/codeceipt/boundaries.json") },
    });
    expect(JSON.parse(cache.out[0] ?? "{}").hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("PH5B-15 a path written with ~ is the home folder (here a link into the repo), so it is still checked", async () => {
    const { repo, home, run } = setup();
    symlinkSync(repo, join(home, "shop"));
    const res = await run("claude", {
      tool_name: "Write",
      tool_input: { file_path: "~/shop/supabase/migrations/x.sql" },
    });
    expect(JSON.parse(res.out[0] ?? "{}").hookSpecificOutput.permissionDecision).toBe("deny");
  });
});
