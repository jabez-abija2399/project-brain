import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeConfig } from "./config";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");
const openai = ["sk", "-proj-", "aB3dE5gH7j", "aB3dE5gH7j", "aB3dE5gH7j"].join("");
const NOTE = "LAST SESSION\nGoal: add reviews\nNext step: wire the stars";

type Call = { path: string; tool?: string; args?: Record<string, unknown>; auth: string | null };

// A fake Codeceipt server: the MCP route answers tools/call, the open-items route the open checklist.
function server(openAfter: { text: string; status: string }[] = []) {
  const calls: Call[] = [];
  let openCalls = 0;
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const auth = new Headers(init?.headers).get("authorization");
    if (path.endsWith("/open-items")) {
      calls.push({ path, auth });
      openCalls++;
      const items =
        openCalls === 1
          ? [{ text: "Show the reviews list", status: "open" }, ...openAfter]
          : openAfter;
      return Response.json({
        ok: true,
        requests: items.length ? [{ id: "req-1", text: "Add reviews", items }] : [],
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
    return new Response(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text }] } })}\n\n`,
      {
        headers: { "content-type": "text/event-stream" },
      },
    );
  };
  return { calls, fetchImpl };
}

function setup(fetchImpl: CliDeps["fetch"], loggedIn = true) {
  const home = mkdtempSync(join(tmpdir(), "pb-hook-home-"));
  const repo = mkdtempSync(join(tmpdir(), "pb-hook-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  writeFileSync(join(repo, "README.md"), "# app\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  if (loggedIn) {
    linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
      apiUrl: "https://brain.test",
      projectId: "proj-1",
      token: TOKEN,
    });
  }
  const out: string[] = [];
  const err: string[] = [];
  const hook = async (
    event: string,
    agent: string,
    stdin: object = { session_id: "s1", cwd: repo },
  ) => {
    out.length = 0;
    err.length = 0;
    const deps: CliDeps = {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => JSON.stringify(stdin),
    };
    return main(["hook", event, "--agent", agent], deps);
  };
  return { home, repo, git, out, err, hook };
}

describe("FEAT-016 agent hooks", () => {
  it("AC-016-02 session start (Claude Code) shows the where_did_we_stop handoff note, sending Authorization: Bearer <token>", async () => {
    const s = server();
    const t = setup(s.fetchImpl);
    expect(await t.hook("session-start", "claude")).toBe(0);
    expect(t.out).toEqual([NOTE]);
    expect(s.calls).toEqual([
      { path: "/mcp", tool: "where_did_we_stop", args: {}, auth: `Bearer ${TOKEN}` },
    ]);
    // The starting commit is kept in .git (never committed), not in the working tree.
    expect(readdirSync(join(t.repo, ".git", "projectbrain"))).toEqual(["session-s1.json"]);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: t.repo }).toString()).toBe("");
  });

  it("AC-016-07 in Cursor the session-start hook hands the note to the agent as additional_context", async () => {
    const s = server();
    const t = setup(s.fetchImpl);
    expect(await t.hook("session-start", "cursor", { session_id: "c1", workspace_roots: [] })).toBe(
      0,
    );
    expect(JSON.parse(t.out[0] ?? "{}")).toEqual({ additional_context: NOTE });
  });

  it("AC-016-03 session end takes the changed files from git since the session started, scans them and saves progress and a receipt", async () => {
    const s = server();
    const t = setup(s.fetchImpl);
    await t.hook("session-start", "claude");
    writeFileSync(join(t.repo, "src.ts"), "export const a = 1;\n");
    t.git("add", "src.ts");
    t.git("commit", "-q", "-m", "agent work");
    writeFileSync(join(t.repo, "keys.ts"), `export const key = "${openai}";\n`);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: t.repo }).toString().trim();
    // The agent's own claims on stdin are ignored: only git decides what changed.
    await t.hook("session-end", "claude", {
      session_id: "s1",
      cwd: t.repo,
      changedFiles: ["fake.ts"],
    });
    const receipt = s.calls.find((c) => c.tool === "generate_receipt");
    expect(receipt?.args).toEqual({
      requestId: "req-1",
      changedFiles: ["src.ts", "keys.ts"],
      commitSha: head,
      secretFindings: [
        { file: "keys.ts", line: 1, type: "openai_api_key", masked_value: "sk-p***" },
      ],
      secretFindingsOmitted: 0,
    });
    expect(s.calls.find((c) => c.tool === "save_progress")?.args).toEqual({
      goal: "Add reviews",
      done: "Changed 2 files; receipt rc-1",
      nextStep: "Start the next request",
    });
    expect(JSON.stringify(s.calls)).not.toContain(openai.slice(0, 8));
    expect(existsSync(join(t.repo, ".git", "projectbrain", "session-s1.json"))).toBe(false);
  });

  it("AC-016-06 session end warns and lists the checklist items that are neither done nor parked", async () => {
    const s = server([
      { text: "Add a star rating", status: "partial" },
      { text: "Email the owner", status: "missed" },
    ]);
    const t = setup(s.fetchImpl);
    await t.hook("session-start", "claude");
    writeFileSync(join(t.repo, "stars.tsx"), "export const Stars = () => null;\n");
    expect(await t.hook("session-end", "claude")).toBe(2);
    expect(t.err).toEqual([
      "Codeceipt: 2 checklist items are neither done nor parked:",
      "  - [partial] Add a star rating",
      "  - [missed] Email the owner",
    ]);
    expect(s.calls.find((c) => c.tool === "save_progress")?.args).toMatchObject({
      unfinished: "Add a star rating; Email the owner",
      nextStep: "Add a star rating",
    });
  });

  it("AC-016-02 attack: with the server unreachable or no login, the hooks print one short warning and never fail the session", async () => {
    const down: CliDeps["fetch"] = async () => {
      throw new TypeError("fetch failed");
    };
    const t = setup(down);
    expect(await t.hook("session-start", "claude")).toBe(0);
    expect(t.out).toEqual([]);
    expect(t.err).toEqual(["Codeceipt: server unreachable; no handoff note this session."]);
    writeFileSync(join(t.repo, "x.ts"), "export {};\n");
    await t.hook("session-end", "claude");
    expect(t.err).toEqual(["Codeceipt: server unreachable; progress and receipt were not saved."]);
    const anon = setup(down, false);
    expect(await anon.hook("session-start", "cursor")).toBe(0);
    expect(anon.err).toHaveLength(1);
    expect(anon.out).toEqual([]);
  });

  it("AC-016-01 mcp-headers prints the Authorization header from the user-level login only", async () => {
    const t = setup(server().fetchImpl);
    const out: string[] = [];
    const deps = {
      fetch: server().fetchImpl,
      env: { XDG_CONFIG_HOME: join(t.repo, "..", "nowhere") },
      cwd: t.repo,
      homedir: t.repo,
      platform: "linux" as const,
      stdout: (l: string) => out.push(l),
      stderr: () => {},
      readStdin: async () => "",
    };
    expect(await main(["mcp-headers"], deps)).toBe(0);
    expect(out).toEqual(["{}"]);
    out.length = 0;
    expect(
      await main(["mcp-headers"], {
        ...deps,
        env: {
          XDG_CONFIG_HOME: join(t.home, ".config"),
          CLAUDE_CODE_MCP_SERVER_URL: "https://brain.test/mcp",
        },
      }),
    ).toBe(0);
    expect(JSON.parse(out[0] ?? "{}")).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });
});
