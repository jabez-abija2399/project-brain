import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { writeConfig } from "./config";
import { type CliDeps, main } from "./index";
import { OPENCODE_PLUGIN } from "./templates";
import { linkRepo } from "./test-support";

// D-021: the hooks of Codex, OpenCode and Antigravity reuse the session hooks; the token is built at runtime.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");
const OTHER = ["pb_", "othr", "Z8yW1", "qL4nP"].join("");
const NOTE = "LAST SESSION\nGoal: add reviews\nNext step: wire the stars";

type Call = { path: string; tool?: string; args?: Record<string, unknown>; auth: string | null };

function server() {
  const calls: Call[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const auth = new Headers(init?.headers).get("authorization");
    if (path.endsWith("/open-items")) {
      calls.push({ path, auth });
      return Response.json({
        ok: true,
        requests: [{ id: "req-1", text: "Add reviews", items: [{ text: "List", status: "done" }] }],
      });
    }
    const body = JSON.parse(String(init?.body));
    const { name, arguments: args } = body.params;
    calls.push({ path, tool: name, args, auth });
    const text =
      name === "where_did_we_stop"
        ? NOTE
        : name === "generate_receipt"
          ? JSON.stringify({ receipt_id: "rc-1" })
          : "{}";
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: { content: [{ type: "text", text }] },
    });
  };
  return { calls, fetchImpl };
}

function setup() {
  const home = mkdtempSync(join(tmpdir(), "cc-ahook-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-ahook-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  writeFileSync(join(repo, "README.md"), "# app\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const configFile = join(home, ".config", "codeceipt", "config.json");
  linkRepo(repo, configFile, { apiUrl: "https://brain.test", projectId: "proj-1", token: TOKEN });
  const s = server();
  const out: string[] = [];
  const err: string[] = [];
  const background: { args: string[]; input: string; cwd: string }[] = [];
  const cli = (argv: string[], stdin = "", cwd = repo) => {
    out.length = 0;
    err.length = 0;
    return main(argv, {
      fetch: s.fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => stdin,
      spawnBackground: (args, input, at) => void background.push({ args, input, cwd: at }),
    });
  };
  return { home, repo, git, configFile, calls: s.calls, out, err, background, cli };
}

describe("D-021 agent hooks", () => {
  it("Codex SessionStart prints the handoff note as plain text (developer context), from a subfolder too", async () => {
    const t = setup();
    mkdirSync(join(t.repo, "src"));
    const stdin = JSON.stringify({
      session_id: "019a-codex",
      transcript_path: null,
      cwd: join(t.repo, "src"),
      hook_event_name: "SessionStart",
      model: "gpt-5.5-codex",
      source: "startup",
    });
    expect(
      await t.cli(["hook", "session-start", "--agent", "codex"], stdin, join(t.repo, "src")),
    ).toBe(0);
    expect(t.out).toEqual([NOTE]);
    expect(t.calls.map((c) => [c.tool, c.auth])).toEqual([
      ["where_did_we_stop", `Bearer ${TOKEN}`],
    ]);
  });

  it("Codex SessionEnd (3 s at most) hands the receipt to a background run, which saves the receipt and progress", async () => {
    const t = setup();
    const start = JSON.stringify({
      session_id: "s-codex",
      cwd: t.repo,
      hook_event_name: "SessionStart",
    });
    await t.cli(["hook", "session-start", "--agent", "codex"], start);
    writeFileSync(join(t.repo, "reviews.ts"), "export const reviews = [];\n");
    const end = JSON.stringify({
      session_id: "s-codex",
      cwd: t.repo,
      hook_event_name: "SessionEnd",
      reason: "other",
    });
    t.calls.length = 0;
    expect(await t.cli(["hook", "session-end", "--agent", "codex"], end)).toBe(0);
    expect(t.calls).toEqual([]);
    expect(t.background).toEqual([
      { args: ["hook", "session-end", "--agent", "codex", "--worker"], input: end, cwd: t.repo },
    ]);
    // The background process is the same CLI with --worker.
    const [job] = t.background;
    expect(await t.cli(job?.args ?? [], job?.input ?? "", job?.cwd)).toBe(0);
    const receipt = t.calls.find((c) => c.tool === "generate_receipt");
    expect(receipt?.args?.changedFiles).toEqual(["reviews.ts"]);
    expect(t.calls.some((c) => c.tool === "save_progress")).toBe(true);
    expect(t.calls.every((c) => c.auth === `Bearer ${TOKEN}`)).toBe(true);
  });

  it("Antigravity SessionStart finds the repo from workspacePaths (whatever folder it runs in) and injects the note as a step", async () => {
    const t = setup();
    const stdin = JSON.stringify({
      conversationId: "c0nv-1",
      workspacePaths: [t.repo],
      transcriptPath: "/tmp/t.json",
      artifactDirectoryPath: "/tmp/a",
      modelName: "gemini-3-pro",
    });
    expect(await t.cli(["hook", "session-start", "--agent", "antigravity"], stdin, tmpdir())).toBe(
      0,
    );
    expect(t.out.map((l) => JSON.parse(l))).toEqual([
      { injectSteps: [{ systemMessage: { systemMessage: NOTE } }] },
    ]);
    expect(t.calls.map((c) => c.auth)).toEqual([`Bearer ${TOKEN}`]);
  });

  it("attack: a hook for a folder that is not a linked repo never falls back to the default login's token", async () => {
    const t = setup();
    writeConfig(t.configFile, {
      apiUrl: "https://brain.test",
      projectId: "proj-other",
      token: OTHER,
    });
    const plain = mkdtempSync(join(tmpdir(), "cc-ahook-plain-"));
    for (const [agent, stdin] of [
      ["antigravity", JSON.stringify({ conversationId: "c1", workspacePaths: [plain] })],
      ["codex", JSON.stringify({ session_id: "s1", cwd: plain })],
      ["opencode", JSON.stringify({ session_id: "s1", cwd: plain })],
    ] as const) {
      expect(await t.cli(["hook", "session-start", "--agent", agent], stdin, plain)).toBe(0);
      expect(t.err.join("\n")).toMatch(/not linked to a Codeceipt project/);
    }
    // A relative or garbage workspace path is ignored, never resolved against the hook's folder.
    expect(
      await t.cli(
        ["hook", "session-start", "--agent", "antigravity"],
        JSON.stringify({ workspacePaths: ["../x", 42] }),
        plain,
      ),
    ).toBe(0);
    expect(t.calls).toEqual([]);
  });

  it("`codeceipt receipt` (agents with no session-end event) uses the newest session start in this repo, and prints the result", async () => {
    const t = setup();
    await t.cli(
      ["hook", "session-start", "--agent", "antigravity"],
      JSON.stringify({ conversationId: "c-ag", workspacePaths: [t.repo] }),
    );
    writeFileSync(join(t.repo, "a.ts"), "export const a = 1;\n");
    t.git("add", "a.ts");
    t.git("commit", "-q", "-m", "a");
    writeFileSync(join(t.repo, "b.ts"), "export const b = 1;\n");
    t.calls.length = 0;
    expect(await t.cli(["receipt"])).toBe(0);
    const receipt = t.calls.find((c) => c.tool === "generate_receipt");
    expect((receipt?.args?.changedFiles as string[]).sort()).toEqual(["a.ts", "b.ts"]);
    expect(t.out).toContain("Receipt rc-1 saved for 2 changed files; progress saved.");
  });

  it("`codeceipt receipt` with no session start compares with the last commit, and in an unlinked repo says how to link it", async () => {
    const t = setup();
    writeFileSync(join(t.repo, "c.ts"), "export const c = 1;\n");
    expect(await t.cli(["receipt"])).toBe(0);
    expect(t.calls.find((c) => c.tool === "generate_receipt")?.args?.changedFiles).toEqual([
      "c.ts",
    ]);
    const plain = mkdtempSync(join(tmpdir(), "cc-ahook-plain-"));
    execFileSync("git", ["init", "-q"], { cwd: plain });
    t.calls.length = 0;
    expect(await t.cli(["receipt"], "", plain)).toBe(3);
    expect(t.err).toEqual([
      "This repo is not linked to a Codeceipt project: run `npx codeceipt` here.",
    ]);
    expect(t.calls).toEqual([]);
  });

  it("attack: mcp-proxy --linked-only outside a linked repo answers with an MCP error and never uses the default login", async () => {
    const t = setup();
    writeConfig(t.configFile, {
      apiUrl: "https://brain.test",
      projectId: "proj-other",
      token: OTHER,
    });
    const plain = mkdtempSync(join(tmpdir(), "cc-ahook-plain-"));
    const lines = [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })];
    const out: string[] = [];
    const seen: string[] = [];
    const code = await main(["mcp-proxy", "--linked-only"], {
      fetch: async (_u, init) => {
        seen.push(String(new Headers(init?.headers).get("authorization")));
        return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
      },
      env: { HOME: t.home, XDG_CONFIG_HOME: join(t.home, ".config") },
      cwd: plain,
      homedir: t.home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: () => {},
      readStdin: async () => "",
      stdinLines: async function* () {
        yield* lines;
      },
    });
    expect(code).toBe(0);
    expect(seen).toEqual([]);
    expect(JSON.parse(out[0] ?? "{}").error.code).toBe(-32001);
  });
});

describe("D-021 OpenCode plugin", () => {
  // The plugin file init writes, loaded as OpenCode loads it, with a stand-in `codeceipt` command on PATH.
  async function loadPlugin(script: string) {
    const dir = mkdtempSync(join(tmpdir(), "cc-plugin-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "codeceipt"), script);
    chmodSync(join(bin, "codeceipt"), 0o755);
    const file = join(dir, "codeceipt.js");
    writeFileSync(file, OPENCODE_PLUGIN);
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    return { dir, bin, mod };
  }

  it("on session.created runs the session-start hook (no shell) and adds the note to the session without a reply", async () => {
    const { dir, bin, mod } = await loadPlugin(
      `#!/bin/sh\necho "$@" > "${"$"}(dirname "$0")/../args.txt"\ncat > "${"$"}(dirname "$0")/../stdin.txt"\nprintf 'LAST SESSION\\nNext step: x\\n'\n`,
    );
    const prompts: unknown[] = [];
    const client = { session: { prompt: async (p: unknown) => void prompts.push(p) } };
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const plugin = mod.Codeceipt as (input: unknown) => Promise<{
        event: (e: { event: { type: string; properties?: unknown } }) => Promise<void>;
      }>;
      const hooks = await plugin({ client, directory: dir, worktree: dir });
      await hooks.event({ event: { type: "session.idle", properties: { sessionID: "ses_1" } } });
      expect(prompts).toEqual([]);
      await hooks.event({
        event: { type: "session.created", properties: { info: { id: "ses_1" } } },
      });
    } finally {
      process.env.PATH = path;
    }
    expect(readFileSync(join(dir, "args.txt"), "utf8").trim()).toBe(
      "hook session-start --agent opencode",
    );
    expect(JSON.parse(readFileSync(join(dir, "stdin.txt"), "utf8"))).toEqual({
      session_id: "ses_1",
      cwd: dir,
    });
    expect(prompts).toEqual([
      {
        path: { id: "ses_1" },
        body: { noReply: true, parts: [{ type: "text", text: "LAST SESSION\nNext step: x" }] },
      },
    ]);
  });

  it("does nothing (and never throws) when codeceipt is missing or prints nothing", async () => {
    const { dir, mod } = await loadPlugin("#!/bin/sh\nexit 0\n");
    const prompts: unknown[] = [];
    const client = { session: { prompt: async (p: unknown) => void prompts.push(p) } };
    const path = process.env.PATH;
    process.env.PATH = "/nonexistent";
    try {
      const plugin = mod.Codeceipt as (input: unknown) => Promise<{
        event: (e: { event: { type: string; properties?: unknown } }) => Promise<void>;
      }>;
      const hooks = await plugin({ client, directory: dir, worktree: dir });
      await hooks.event({
        event: { type: "session.created", properties: { info: { id: "ses_2" } } },
      });
    } finally {
      process.env.PATH = path;
    }
    expect(prompts).toEqual([]);
  });
});
