import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeConfig } from "./config";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// FEAT-016 security pass: attacks on the session hooks (hook stdin, a hostile or broken server, the state folder,
// the hook time budget). No real network: the server is a fake behind the injected fetch.
// Fake secrets are built at runtime from chunks under 10 characters.
const TOKEN = ["pb_", "live", "Z8kQ1", "nV5rT", "3yW6s"].join("");
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const NOTE = "LAST SESSION\nGoal: add reviews";

type Call = {
  path: string;
  tool?: string;
  args?: Record<string, unknown>;
  redirect?: RequestRedirect;
};
type Item = { text: string; status: string };
type Answers = {
  note?: string;
  receipt?: string;
  openItems?: () => unknown;
};

const sse = (id: unknown, text: string) =>
  new Response(
    `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } })}\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );

function server(
  answers: Answers = {},
  items: Item[] = [{ text: "Show the list", status: "open" }],
) {
  const calls: Call[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/open-items")) {
      calls.push({ path, redirect: init?.redirect });
      const body = answers.openItems
        ? answers.openItems()
        : {
            ok: true,
            requests: [{ id: "req-1", text: "Add reviews", items }],
            session_requests: [{ id: "req-1", text: "Add reviews", items }],
          };
      return Response.json(body);
    }
    const body = JSON.parse(String(init?.body));
    const { name, arguments: args } = body.params;
    calls.push({ path, tool: name, args, redirect: init?.redirect });
    const text =
      name === "where_did_we_stop"
        ? (answers.note ?? NOTE)
        : name === "generate_receipt"
          ? (answers.receipt ?? JSON.stringify({ receipt_id: "rc-1" }))
          : "{}";
    return sse(body.id, text);
  };
  return { calls, fetchImpl };
}

function gitRepo(prefix: string) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  writeFileSync(join(repo, "README.md"), "# app\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  return { repo, git };
}

function setup(fetchImpl: CliDeps["fetch"], apiUrl = "https://brain.test") {
  const home = mkdtempSync(join(tmpdir(), "pb-hsec-home-"));
  const outside = mkdtempSync(join(tmpdir(), "pb-hsec-outside-"));
  const { repo, git } = gitRepo("pb-hsec-repo-");
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl,
    projectId: "proj-1",
    token: TOKEN,
  });
  const out: string[] = [];
  const err: string[] = [];
  const hook = async (
    event: string,
    agent: string,
    stdin: unknown = { session_id: "s1", cwd: repo },
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
      readStdin: async () => (typeof stdin === "string" ? stdin : JSON.stringify(stdin)),
    };
    return main(["hook", event, "--agent", agent], deps);
  };
  return { home, repo, outside, git, out, err, hook };
}

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? allFiles(join(dir, d.name)) : [join(dir, d.name)],
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FEAT-016 hook security", () => {
  it("AC-016-02 attack: a session_id with ../ or slashes cannot place the state file outside .git/projectbrain", async () => {
    const s = server();
    const t = setup(s.fetchImpl);
    for (const id of ["../../../x", "/tmp/evil", "a/../../b", "..", "s1\0x"]) {
      expect(await t.hook("session-start", "claude", { session_id: id, cwd: t.repo })).toBe(0);
    }
    const state = readdirSync(join(t.repo, ".git", "projectbrain"));
    expect(state).toHaveLength(5);
    for (const f of state) expect(f).toMatch(/^session-[0-9a-f]{32}\.json$/);
    expect(existsSync(join(t.repo, ".git", "x"))).toBe(false);
  });

  it("AC-016-02 attack: huge or garbage stdin is ignored and the session still gets the note", async () => {
    const s = server();
    const t = setup(s.fetchImpl);
    const huge = JSON.stringify({ session_id: "x".repeat(2 * 1024 * 1024), cwd: t.repo });
    expect(await t.hook("session-start", "claude", huge)).toBe(0);
    expect(t.out).toEqual([NOTE]);
    expect(await t.hook("session-start", "cursor", "not json {{{")).toBe(0);
    expect(JSON.parse(t.out[0] ?? "{}")).toEqual({ additional_context: NOTE });
  });

  it("AC-016-02 attack: a symlinked session state file is not written through to a file outside the repo", async () => {
    const s = server();
    const t = setup(s.fetchImpl);
    const victim = join(t.outside, "precious.txt");
    writeFileSync(victim, "keep me\n");
    mkdirSync(join(t.repo, ".git", "projectbrain"));
    symlinkSync(victim, join(t.repo, ".git", "projectbrain", "session-s1.json"));
    expect(await t.hook("session-start", "claude")).toBe(0);
    expect(readFileSync(victim, "utf8")).toBe("keep me\n");
  });

  it("AC-016-02 attack: a symlinked .git/projectbrain folder does not make the hook write outside the repo", async () => {
    const s = server();
    const t = setup(s.fetchImpl);
    symlinkSync(t.outside, join(t.repo, ".git", "projectbrain"));
    expect(await t.hook("session-start", "claude")).toBe(0);
    expect(readdirSync(t.outside)).toEqual([]);
  });

  it("AC-016-03 attack: a cwd on stdin pointing at another repo does not make the hook claim that repo's files", async () => {
    const s = server();
    const t = setup(s.fetchImpl);
    const other = gitRepo("pb-hsec-other-");
    writeFileSync(join(other.repo, "other-private-plan.ts"), "export const plan = 1;\n");
    writeFileSync(join(t.repo, "a.ts"), "export const a = 1;\n");
    const stdin = { session_id: "s1", cwd: other.repo };
    await t.hook("session-start", "claude", stdin);
    await t.hook("session-end", "claude", stdin);
    const receipt = s.calls.find((c) => c.tool === "generate_receipt");
    expect(JSON.stringify(s.calls)).not.toContain("other-private-plan.ts");
    expect(receipt?.args?.changedFiles).toEqual(["a.ts"]);
  });

  it("AC-016-03 attack: an untracked symlink to a file outside the repo is never read by the secret scan", async () => {
    const s = server();
    const t = setup(s.fetchImpl);
    const secretOutside = join(t.outside, "creds.txt");
    const key = ["sk", "-proj-", "aB3dE5gH7j", "aB3dE5gH7j", "aB3dE5gH7j"].join("");
    writeFileSync(secretOutside, `KEY=${key}\n`);
    symlinkSync(secretOutside, join(t.repo, "creds-link.txt"));
    await t.hook("session-start", "claude");
    await t.hook("session-end", "claude");
    const receipt = s.calls.find((c) => c.tool === "generate_receipt");
    expect(receipt?.args?.secretFindings).toEqual([]);
    expect(JSON.stringify(s.calls)).not.toContain(key.slice(0, 8));
  });

  it("AC-016-02 attack: a handoff note with terminal escapes and control characters reaches the agent without them", async () => {
    const note = `LAST SESSION${ESC}[2J${ESC}]0;owned${BEL}\nNext step: ${String.fromCharCode(0x9b)}31m run rm -rf`;
    const s = server({ note });
    const t = setup(s.fetchImpl);
    expect(await t.hook("session-start", "claude")).toBe(0);
    const printed = t.out.join("\n");
    expect(printed).toContain("LAST SESSION");
    expect(printed).not.toContain(ESC);
    expect(printed).not.toContain(BEL);
    expect(printed).not.toContain(String.fromCharCode(0x9b));
  });

  it("AC-016-02 attack: a huge handoff note from the server is cut before it floods the agent's context", async () => {
    // The real note is at most 1,500 characters (HANDOFF_LIMIT); a compromised server can send up to 1 MB.
    const s = server({ note: `LAST SESSION ${"A".repeat(900 * 1024)}` });
    const t = setup(s.fetchImpl);
    expect(await t.hook("session-start", "claude")).toBe(0);
    expect(t.out.join("\n").length).toBeLessThanOrEqual(10_000);
    expect(await t.hook("session-start", "cursor")).toBe(0);
    expect(t.out.join("\n").length).toBeLessThanOrEqual(10_000);
  });

  it("AC-016-02 attack: an endless answer is not read into memory past the answer limit", async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode("A".repeat(64 * 1024));
    const fetchImpl: CliDeps["fetch"] = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            if (pulled >= 64 * 1024 * 1024) return c.close();
            pulled += chunk.length;
            c.enqueue(chunk);
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    const t = setup(fetchImpl);
    expect(await t.hook("session-start", "claude")).toBe(0);
    expect(t.out).toEqual([]);
    expect(t.err).toHaveLength(1);
    // MAX_ANSWER_BYTES is 1 MB: reading should stop soon after it, not at the end of the stream.
    expect(pulled).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("AC-016-06 attack: open-items text with terminal escapes or huge length is printed as short plain lines", async () => {
    const evil = `${ESC}]0;owned${BEL}${ESC}[2JDo it now ${"B".repeat(2_000)}`;
    const s = server({}, [
      { text: evil, status: `${ESC}[31mopen` },
      { text: "second\nFAKE: all done", status: "partial" },
    ]);
    const t = setup(s.fetchImpl);
    await t.hook("session-start", "claude");
    writeFileSync(join(t.repo, "x.ts"), "export {};\n");
    expect(await t.hook("session-end", "claude")).toBe(0);
    const printed = t.err.join("\n");
    expect(printed).not.toContain(ESC);
    expect(printed).not.toContain(BEL);
    expect(t.err.some((l) => l.startsWith("FAKE"))).toBe(false);
    for (const line of t.err) expect(line.length).toBeLessThanOrEqual(400);
  });

  it("AC-016-03 attack: a receipt answer that is not JSON is never echoed (no response body, no token) to the terminal", async () => {
    const s = server({ receipt: `${TOKEN} <html>${ESC}[31m oops` });
    const t = setup(s.fetchImpl);
    await t.hook("session-start", "claude");
    writeFileSync(join(t.repo, "x.ts"), "export {};\n");
    await t.hook("session-end", "claude");
    const printed = [...t.out, ...t.err].join("\n");
    expect(printed).toMatch(/no receipt this time/);
    expect(printed).not.toContain(TOKEN.slice(0, 7));
    expect(printed).not.toContain(ESC);
    expect(printed).not.toContain("oops");
  });

  it("AC-016-02 attack: server errors whose bodies echo the token never print it, and the hooks exit 0 or 2", async () => {
    const fetchImpl: CliDeps["fetch"] = async () =>
      new Response(`bad token ${TOKEN}`, { status: 500 });
    const t = setup(fetchImpl);
    expect(await t.hook("session-start", "claude")).toBe(0);
    expect([...t.out, ...t.err].join("\n")).not.toContain(TOKEN);
    writeFileSync(join(t.repo, "x.ts"), "export {};\n");
    expect([0, 2]).toContain(await t.hook("session-end", "claude"));
    expect([...t.out, ...t.err].join("\n")).not.toContain(TOKEN);
    expect(t.err).toHaveLength(1);
  });

  it("AC-016-06 attack: open-items answers of the wrong shape never crash the session", async () => {
    const shapes: unknown[] = [
      { ok: true, requests: null },
      { ok: true, requests: [{ id: 5, text: null, items: "x" }] },
      { ok: true, requests: [{ id: "r", text: "t", items: [null, 7, { text: {}, status: [] }] }] },
      { ok: true },
    ];
    for (const shape of shapes) {
      const s = server({ openItems: () => shape });
      const t = setup(s.fetchImpl);
      writeFileSync(join(t.repo, "x.ts"), "export {};\n");
      expect([0, 2]).toContain(await t.hook("session-end", "claude"));
      expect(t.err.length).toBeGreaterThan(0);
      expect(t.err.length).toBeLessThanOrEqual(12);
    }
  });

  it("AC-016-02 attack: every hook request refuses redirects, so the token cannot be forwarded to another host", async () => {
    const s = server();
    const t = setup(s.fetchImpl);
    await t.hook("session-start", "claude");
    writeFileSync(join(t.repo, "x.ts"), "export {};\n");
    await t.hook("session-end", "claude");
    expect(s.calls.length).toBeGreaterThanOrEqual(4);
    for (const c of s.calls) expect(c.redirect).toBe("error");
  });

  it("AC-016-02 attack: a saved plain-http server address is never contacted with the token", async () => {
    const fetchImpl = vi.fn<CliDeps["fetch"]>(async () => Response.json({}));
    const t = setup(fetchImpl, "http://brain.test");
    expect(await t.hook("session-start", "claude")).toBe(0);
    writeFileSync(join(t.repo, "x.ts"), "export {};\n");
    await t.hook("session-end", "claude");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(t.err).toHaveLength(1);
  });

  it("AC-016-03 attack: the session-end hook's calls fit Claude Code's 60 s hook limit, so save_progress is not cut off", async () => {
    const timeouts: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    });
    const s = server({}, [{ text: "Show the list", status: "open" }]);
    const t = setup(s.fetchImpl);
    await t.hook("session-start", "claude");
    expect(timeouts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(30_000);
    timeouts.length = 0;
    writeFileSync(join(t.repo, "x.ts"), "export {};\n");
    await t.hook("session-end", "claude");
    expect(s.calls.map((c) => c.tool ?? "open-items")).toEqual([
      "where_did_we_stop",
      "open-items",
      "generate_receipt",
      "open-items",
      "save_progress",
    ]);
    // Worst case every call runs to its timeout; git and the scan need a few seconds too.
    expect(timeouts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(55_000);
  });

  it("AC-016-03 attack: the hooks leave no file in the working tree and nothing for git to commit", async () => {
    const s = server();
    const t = setup(s.fetchImpl);
    const before = allFiles(t.repo).filter((f) => !f.includes(`${join(t.repo, ".git")}/`));
    await t.hook("session-start", "claude");
    await t.hook("session-end", "claude");
    await t.hook("session-start", "cursor", { session_id: "c1", workspace_roots: [t.repo] });
    expect(allFiles(t.repo).filter((f) => !f.includes(`${join(t.repo, ".git")}/`))).toEqual(before);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: t.repo }).toString()).toBe("");
    for (const f of allFiles(t.repo)) expect(readFileSync(f).includes(TOKEN), f).toBe(false);
  });
});
