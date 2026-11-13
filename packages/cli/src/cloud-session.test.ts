import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, DEFAULT_API_URL, cloudSessionConfig, main } from "./index";

// Cloud sessions (Claude Code on the web): a fresh clone with no link file and no saved token; the key comes from the
// cloud environment's CODECEIPT_TOKEN + CODECEIPT_PROJECT_ID. Fake keys are built at run time.
const TOKEN_A = ["pb_", "aaaa", "Q7xT2", "mK9vR"].join("");
const TOKEN_B = ["pb_", "bbbb", "Z8yW1", "qL4nP"].join("");
const PROJECT = { [TOKEN_A]: "proj-a", [TOKEN_B]: "proj-b" } as Record<string, string>;

type Call = { url: string; auth: string | null; repo: string | null; tool?: string };

function server() {
  const calls: Call[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization");
    const path = new URL(String(url)).pathname;
    let tool: string | undefined;
    if (path === "/mcp") tool = JSON.parse(String(init?.body)).params?.name;
    calls.push({ url: String(url), auth, repo: headers.get("x-codeceipt-repo"), tool });
    if (path === "/api/token/whoami") {
      const token = auth?.replace(/^Bearer /, "") ?? "";
      return PROJECT[token]
        ? Response.json({ ok: true, project_id: PROJECT[token] })
        : Response.json({ ok: false }, { status: 401 });
    }
    if (path === "/mcp") {
      const body = JSON.parse(String(init?.body));
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "note" }] },
      });
    }
    return Response.json({ ok: true, requests: [], changed: [], deleted: [], held: [] });
  };
  return { calls, fetchImpl };
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "cc-cloud-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: dir,
    });
  git("init", "-q");
  writeFileSync(join(dir, "README.md"), "# app\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  return dir;
}

function cli(fetchImpl: CliDeps["fetch"]) {
  const home = mkdtempSync(join(tmpdir(), "cc-cloud-home-"));
  const out: string[] = [];
  const err: string[] = [];
  const run = (cwd: string, argv: string[], stdin: string, env: Record<string, string> = {}) =>
    main(argv, {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), ...env },
      cwd,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => stdin,
    });
  return { out, err, run };
}

const CLOUD = { CODECEIPT_TOKEN: TOKEN_A, CODECEIPT_PROJECT_ID: "proj-a" };

async function session(c: ReturnType<typeof cli>, dir: string, env: Record<string, string>) {
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  for (const event of ["session-start", "session-end"]) {
    await c.run(
      dir,
      ["hook", event, "--agent", "claude"],
      JSON.stringify({ session_id: "s1", cwd: dir }),
      env,
    );
  }
}

function linkRepo(dir: string, apiUrl: string, projectId: string) {
  mkdirSync(join(dir, ".git", "codeceipt"), { recursive: true });
  writeFileSync(
    join(dir, ".git", "codeceipt", "project.json"),
    JSON.stringify({ apiUrl, projectId }),
  );
}

describe("cloud sessions: key from the environment", () => {
  it("CS-01 a fresh clone with CODECEIPT_TOKEN + CODECEIPT_PROJECT_ID gets a start note and a receipt", async () => {
    const s = server();
    const dir = repo();
    await session(cli(s.fetchImpl), dir, CLOUD);
    const tools = s.calls.map((c) => c.tool).filter(Boolean);
    expect(tools).toContain("where_did_we_stop");
    expect(tools).toContain("save_progress");
    expect(s.calls.length).toBeGreaterThan(0);
    for (const c of s.calls) {
      expect(c.auth).toBe(`Bearer ${TOKEN_A}`);
      expect(new URL(c.url).origin).toBe(DEFAULT_API_URL);
    }
    // The repo fingerprint still rides on the hook routes, so the server refuses a different repository's uploads.
    const hookCalls = s.calls.filter((c) => new URL(c.url).pathname.startsWith("/api/hooks/"));
    expect(hookCalls.length).toBeGreaterThan(0);
    for (const c of hookCalls) expect(c.repo).toBeTruthy();
  });

  it("CS-02 without the variables a fresh clone sends nothing", async () => {
    const s = server();
    const dir = repo();
    await session(cli(s.fetchImpl), dir, {});
    expect(s.calls).toEqual([]);
  });

  it("CS-03 attack: CODECEIPT_API_URL (which a repo's own settings can set) never redirects the key", async () => {
    const s = server();
    const dir = repo();
    await session(cli(s.fetchImpl), dir, { ...CLOUD, CODECEIPT_API_URL: "https://evil.test" });
    expect(s.calls.length).toBeGreaterThan(0);
    for (const c of s.calls) expect(new URL(c.url).origin).toBe(DEFAULT_API_URL);
  });

  it("CS-04 attack: the key is never printed", async () => {
    const s = server();
    const dir = repo();
    const c = cli(s.fetchImpl);
    await session(c, dir, CLOUD);
    await c.run(dir, ["status"], "", CLOUD);
    expect([...c.out, ...c.err].join("\n")).not.toContain(TOKEN_A);
  });

  it("CS-05 a saved login on this computer wins over the environment", async () => {
    const s = server();
    const dir = repo();
    const c = cli(s.fetchImpl);
    expect(await c.run(dir, ["login"], `${TOKEN_B}\n`)).toBe(0);
    s.calls.length = 0;
    await session(c, dir, CLOUD);
    expect(s.calls.length).toBeGreaterThan(0);
    for (const call of s.calls) expect(call.auth).toBe(`Bearer ${TOKEN_B}`);
  });

  it("CS-06 attack: a repo linked to another project never gets the environment key", async () => {
    const s = server();
    const dir = repo();
    linkRepo(dir, DEFAULT_API_URL, "proj-b");
    await session(cli(s.fetchImpl), dir, CLOUD);
    expect(s.calls).toEqual([]);
  });

  it("CS-07 attack: a repo linked to the same project on another server never gets the environment key", async () => {
    const s = server();
    const dir = repo();
    linkRepo(dir, "https://evil.test", "proj-a");
    await session(cli(s.fetchImpl), dir, CLOUD);
    expect(s.calls).toEqual([]);
  });

  it("CS-08 a repo linked to the same project with no saved token uses the environment key", async () => {
    const s = server();
    const dir = repo();
    linkRepo(dir, DEFAULT_API_URL, "proj-a");
    await session(cli(s.fetchImpl), dir, CLOUD);
    expect(s.calls.length).toBeGreaterThan(0);
    for (const c of s.calls) expect(c.auth).toBe(`Bearer ${TOKEN_A}`);
  });

  it("CS-09 attack: malformed values (header injection, bad project id) are ignored", () => {
    expect(cloudSessionConfig(CLOUD)).toEqual({
      apiUrl: DEFAULT_API_URL,
      projectId: "proj-a",
      token: TOKEN_A,
    });
    expect(cloudSessionConfig({ ...CLOUD, CODECEIPT_TOKEN: `${TOKEN_A}\r\nx-evil: 1` })).toBeNull();
    expect(cloudSessionConfig({ ...CLOUD, CODECEIPT_TOKEN: "short" })).toBeNull();
    expect(cloudSessionConfig({ ...CLOUD, CODECEIPT_PROJECT_ID: "../proj" })).toBeNull();
    expect(cloudSessionConfig({ CODECEIPT_TOKEN: TOKEN_A })).toBeNull();
    expect(cloudSessionConfig({ CODECEIPT_PROJECT_ID: "proj-a" })).toBeNull();
  });

  it("CS-10 attack: login with the key from the environment ignores CODECEIPT_API_URL", async () => {
    const s = server();
    const dir = repo();
    const c = cli(s.fetchImpl);
    await c.run(dir, ["login"], "", { ...CLOUD, CODECEIPT_API_URL: "https://evil.test" });
    expect(s.calls.length).toBeGreaterThan(0);
    for (const call of s.calls) expect(new URL(call.url).origin).toBe(DEFAULT_API_URL);
  });

  it("CS-11 login from stdin still honours CODECEIPT_API_URL (self-hosted servers)", async () => {
    const s = server();
    const dir = repo();
    const c = cli(s.fetchImpl);
    await c.run(dir, ["login"], `${TOKEN_A}\n`, { CODECEIPT_API_URL: "https://brain.test" });
    expect(s.calls.length).toBeGreaterThan(0);
    for (const call of s.calls) expect(new URL(call.url).origin).toBe("https://brain.test");
  });

  it("CS-12 doctor in a cloud session counts the environment key as the login and npx as normal", async () => {
    const s = server();
    const dir = repo();
    const c = cli(s.fetchImpl);
    expect(await c.run(dir, ["init", "--claude"], "", CLOUD)).toBe(0);
    c.out.length = 0;
    await c.run(dir, ["doctor"], "", CLOUD);
    const text = c.out.join("\n");
    expect(text).toContain("Using the project key from this environment (CODECEIPT_TOKEN)");
    expect(text).toContain("This repo is linked to project proj-a");
    expect(text).toContain("hooks run it through npx (normal in a cloud session)");
    expect(text).toContain("Claude Code hooks are set up (they run codeceipt through npx here)");
    expect(text).not.toContain("Not logged in on this computer");
    expect(text).not.toContain("fall back to npx (slower");
    expect(text).not.toContain(TOKEN_A);
  });

  it("CS-13 without the environment key, doctor still reports the missing login", async () => {
    const s = server();
    const dir = repo();
    const c = cli(s.fetchImpl);
    await c.run(dir, ["doctor"], "", {});
    expect(c.out.join("\n")).toContain("Not logged in on this computer");
  });

  it("CS-14 init --claude makes Claude Code read AGENTS.md through CLAUDE.md, and keeps what the user wrote", async () => {
    const s = server();
    const c = cli(s.fetchImpl);
    const fresh = repo();
    expect(await c.run(fresh, ["init", "--claude"], "", CLOUD)).toBe(0);
    expect(readFileSync(join(fresh, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    expect(c.out).toContain("  added   CLAUDE.md: reads AGENTS.md (@AGENTS.md)");
    // A second run adds nothing.
    expect(await c.run(fresh, ["init", "--claude"], "", CLOUD)).toBe(0);
    expect(readFileSync(join(fresh, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    // An existing CLAUDE.md keeps every line and gets the import at the end.
    const own = repo();
    writeFileSync(join(own, "CLAUDE.md"), "# My rules\nUse pnpm.");
    expect(await c.run(own, ["init", "--claude"], "", CLOUD)).toBe(0);
    expect(readFileSync(join(own, "CLAUDE.md"), "utf8")).toBe(
      "# My rules\nUse pnpm.\n\n@AGENTS.md\n",
    );
  });

  it("CS-15 attack: a CLAUDE.md that is a symlink is never written through", async () => {
    const s = server();
    const c = cli(s.fetchImpl);
    const dir = repo();
    const outside = join(mkdtempSync(join(tmpdir(), "cc-cloud-out-")), "target.md");
    writeFileSync(outside, "untouched\n");
    symlinkSync(outside, join(dir, "CLAUDE.md"));
    expect(await c.run(dir, ["init", "--claude"], "", CLOUD)).toBe(0);
    expect(readFileSync(outside, "utf8")).toBe("untouched\n");
  });
});
