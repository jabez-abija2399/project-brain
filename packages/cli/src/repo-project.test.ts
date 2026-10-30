import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";

// One project per repo: each repo's project link lives in its own .git folder (never the token); tokens stay in the
// user config, one per project. Built at runtime in chunks under 10 characters.
const TOKEN_A = ["pb_", "aaaa", "Q7xT2", "mK9vR"].join("");
const TOKEN_B = ["pb_", "bbbb", "Z8yW1", "qL4nP"].join("");
const PROJECT = { [TOKEN_A]: "proj-a", [TOKEN_B]: "proj-b" } as Record<string, string>;
const API = "https://brain.test";

type Call = { path: string; tool?: string; auth: string | null; args?: Record<string, unknown> };

// A fake server that knows two tokens and records which token every call carried.
function server() {
  const calls: Call[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const auth = new Headers(init?.headers).get("authorization");
    const token = auth?.replace(/^Bearer /, "") ?? "";
    if (path === "/api/token/whoami") {
      return PROJECT[token]
        ? Response.json({ ok: true, project_id: PROJECT[token] })
        : Response.json({ ok: false }, { status: 401 });
    }
    if (path.endsWith("/open-items")) {
      calls.push({ path, auth });
      return Response.json({ ok: true, requests: [] });
    }
    if (path === "/mcp") {
      const body = JSON.parse(String(init?.body));
      calls.push({ path, tool: body.params?.name, auth, args: body.params?.arguments });
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "note" }] },
      });
    }
    calls.push({ path, auth });
    // The index endpoints' answers, in the shapes the CLI reads (upload, diff, features, summarize).
    return Response.json({
      ok: true,
      files: 0,
      symbols: 0,
      changed: [],
      deleted: [],
      held: [],
      features: 0,
      shared: 0,
      attempted: 0,
      remaining: 0,
      enabled: false,
    });
  };
  return { calls, fetchImpl };
}

function repo(name: string) {
  const dir = mkdtempSync(join(tmpdir(), `cc-${name}-`));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: dir,
    });
  git("init", "-q");
  writeFileSync(join(dir, "README.md"), "# app\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  return { dir, git };
}

function cli(home: string, fetchImpl: CliDeps["fetch"]) {
  const out: string[] = [];
  const err: string[] = [];
  const run = (cwd: string, argv: string[], stdin = "", env: Record<string, string> = {}) => {
    out.length = 0;
    err.length = 0;
    return main(argv, {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), ...env },
      cwd,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => stdin,
    });
  };
  return { out, err, run };
}

const linkFile = (dir: string) => join(dir, ".git", "codeceipt", "project.json");
const configFile = (home: string) => join(home, ".config", "codeceipt", "config.json");

describe("one project per repo", () => {
  it("login in a repo links that repo (project only, never the token) and keeps the token in the user config", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const s = server();
    const a = repo("a");
    const c = cli(home, s.fetchImpl);
    expect(await c.run(a.dir, ["login", "--api-url", API], `${TOKEN_A}\n`)).toBe(0);
    expect(JSON.parse(readFileSync(linkFile(a.dir), "utf8"))).toEqual({
      apiUrl: API,
      projectId: "proj-a",
    });
    expect(readFileSync(linkFile(a.dir), "utf8")).not.toContain(TOKEN_A);
    expect(readFileSync(configFile(home), "utf8")).toContain(TOKEN_A);
    expect(c.out).toEqual(["Logged in as project proj-a", "This repo now uses project proj-a."]);
    // Nothing is written into the working tree.
    expect(a.git("status", "--porcelain").toString()).toBe("");
  });

  it("attack: two repos on one machine never mix receipts or progress", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const s = server();
    const a = repo("a");
    const b = repo("b");
    const c = cli(home, s.fetchImpl);
    expect(await c.run(a.dir, ["login", "--api-url", API], `${TOKEN_A}\n`)).toBe(0);
    expect(await c.run(b.dir, ["login", "--api-url", API], `${TOKEN_B}\n`)).toBe(0);
    // A change and a session end in each repo, in an interleaved order.
    writeFileSync(join(a.dir, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(b.dir, "b.ts"), "export const b = 1;\n");
    for (const [r, id] of [
      [a, "sa"],
      [b, "sb"],
    ] as const) {
      await c.run(
        r.dir,
        ["hook", "session-start", "--agent", "claude"],
        JSON.stringify({ session_id: id, cwd: r.dir }),
      );
    }
    for (const [r, id] of [
      [b, "sb"],
      [a, "sa"],
    ] as const) {
      await c.run(
        r.dir,
        ["hook", "session-end", "--agent", "claude"],
        JSON.stringify({ session_id: id, cwd: r.dir }),
      );
    }
    const saves = s.calls.filter((x) => x.tool === "save_progress");
    expect(saves.map((x) => x.auth)).toEqual([`Bearer ${TOKEN_B}`, `Bearer ${TOKEN_A}`]);
    const notes = s.calls.filter((x) => x.tool === "where_did_we_stop");
    expect(notes.map((x) => x.auth)).toEqual([`Bearer ${TOKEN_A}`, `Bearer ${TOKEN_B}`]);
    const open = s.calls.filter((x) => x.path.endsWith("/open-items"));
    expect(open.map((x) => [x.path, x.auth])).toEqual([
      ["/api/hooks/proj-b/open-items", `Bearer ${TOKEN_B}`],
      ["/api/hooks/proj-a/open-items", `Bearer ${TOKEN_A}`],
    ]);
    // Indexing each repo uploads to its own project with its own token.
    s.calls.length = 0;
    expect(await c.run(a.dir, ["index"])).toBe(0);
    expect(await c.run(b.dir, ["index"])).toBe(0);
    const uploads = s.calls.filter((x) => x.path.startsWith("/api/index/"));
    expect(new Set(uploads.filter((x) => x.path.includes("proj-a")).map((x) => x.auth))).toEqual(
      new Set([`Bearer ${TOKEN_A}`]),
    );
    expect(new Set(uploads.filter((x) => x.path.includes("proj-b")).map((x) => x.auth))).toEqual(
      new Set([`Bearer ${TOKEN_B}`]),
    );
  });

  it("a repo with no link says to run npx codeceipt there (index, init and hooks), even when another repo is logged in", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const s = server();
    const a = repo("a");
    const plain = repo("plain");
    const c = cli(home, s.fetchImpl);
    expect(await c.run(a.dir, ["login", "--api-url", API], `${TOKEN_A}\n`)).toBe(0);
    s.calls.length = 0;
    const message = "This repo is not linked to a Codeceipt project: run `npx codeceipt` here.";
    expect(await c.run(plain.dir, ["index"])).toBe(3);
    expect(c.err).toEqual([message]);
    mkdirSync(join(plain.dir, ".claude"));
    expect(await c.run(plain.dir, ["init"])).toBe(3);
    expect(c.err).toEqual([message]);
    expect(
      await c.run(
        plain.dir,
        ["hook", "session-start", "--agent", "claude"],
        JSON.stringify({ session_id: "s", cwd: plain.dir }),
      ),
    ).toBe(0);
    expect(c.err).toEqual([
      "Codeceipt: this repo is not linked to a Codeceipt project (run `npx codeceipt` here); no handoff note.",
    ]);
    // Repo A's token was never sent for the unlinked repo.
    expect(s.calls).toEqual([]);
  });

  it("attack: a link file naming another project (no token for it here) or a symlinked link file is not used", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const s = server();
    const a = repo("a");
    const c = cli(home, s.fetchImpl);
    expect(await c.run(a.dir, ["login", "--api-url", API], `${TOKEN_A}\n`)).toBe(0);
    // Hand-edited to another project: the token of proj-a is never sent for it.
    writeFileSync(linkFile(a.dir), JSON.stringify({ apiUrl: API, projectId: "proj-z" }));
    s.calls.length = 0;
    expect(await c.run(a.dir, ["index"])).toBe(3);
    expect(c.err).toEqual([
      "This repo is linked to a project this computer has no token for: run `npx codeceipt` here.",
    ]);
    // Pointed at another server: the token is never sent there either.
    writeFileSync(
      linkFile(a.dir),
      JSON.stringify({ apiUrl: "https://evil.test", projectId: "proj-a" }),
    );
    expect(await c.run(a.dir, ["index"])).toBe(3);
    expect(s.calls).toEqual([]);
    // A symlinked link file is not read, and login does not write through it.
    const outside = join(mkdtempSync(join(tmpdir(), "cc-outside-")), "victim.json");
    writeFileSync(outside, JSON.stringify({ apiUrl: API, projectId: "proj-a" }));
    const { rmSync } = await import("node:fs");
    rmSync(linkFile(a.dir));
    symlinkSync(outside, linkFile(a.dir));
    expect(await c.run(a.dir, ["index"])).toBe(3);
    await c.run(a.dir, ["login", "--api-url", API], `${TOKEN_B}\n`);
    expect(JSON.parse(readFileSync(outside, "utf8"))).toEqual({ apiUrl: API, projectId: "proj-a" });
  });

  it("the Claude Code header helper gives each repo's own token, and only to the server that issued it", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const s = server();
    const a = repo("a");
    const b = repo("b");
    const c = cli(home, s.fetchImpl);
    await c.run(a.dir, ["login", "--api-url", API], `${TOKEN_A}\n`);
    await c.run(b.dir, ["login", "--api-url", API], `${TOKEN_B}\n`);
    const env = { CLAUDE_CODE_MCP_SERVER_URL: `${API}/mcp` };
    expect(await c.run(b.dir, ["mcp-headers"], "", env)).toBe(0);
    expect(c.out).toEqual([JSON.stringify({ Authorization: `Bearer ${TOKEN_B}` })]);
    expect(await c.run(a.dir, ["mcp-headers"], "", env)).toBe(0);
    expect(c.out).toEqual([JSON.stringify({ Authorization: `Bearer ${TOKEN_A}` })]);
    expect(
      await c.run(a.dir, ["mcp-headers"], "", {
        CLAUDE_CODE_MCP_SERVER_URL: "https://evil.test/mcp",
      }),
    ).toBe(0);
    expect(c.out).toEqual(["{}"]);
    expect(existsSync(linkFile(a.dir))).toBe(true);
  });
});
