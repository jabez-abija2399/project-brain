import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// Requests captured from each agent's prompt-submit hook, and receipts that check only the session's own requests.
// The token is built at runtime.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");

type Sent = { path: string; method: string; body?: Record<string, unknown>; query?: string };

function setup(opts: { sessionRequests?: unknown[]; requests?: unknown[] } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cc-prompt-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-prompt-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  writeFileSync(join(repo, "app.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const sent: Sent[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Bearer ${TOKEN}`) throw new Error("wrong token");
    if (u.pathname.endsWith("/requests")) {
      sent.push({ path: u.pathname, method, body: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true, recorded: true });
    }
    if (u.pathname.endsWith("/open-items")) {
      sent.push({ path: u.pathname, method, query: u.search });
      return Response.json({
        ok: true,
        requests: opts.requests ?? [],
        session_requests: opts.sessionRequests ?? [],
      });
    }
    const body = JSON.parse(String(init?.body));
    sent.push({ path: u.pathname, method, body: body.params });
    const text =
      body.params.name === "generate_receipt"
        ? JSON.stringify({
            receipt_id: "rc-1",
            items: [{ status: "done" }],
            outside_scope: [],
            not_verified: [],
          })
        : "{}";
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: { content: [{ type: "text", text }] },
    });
  };
  const out: string[] = [];
  const err: string[] = [];
  const background: { args: string[]; input: string }[] = [];
  const run = (argv: string[], stdin: object | string, background_?: boolean) => {
    out.length = 0;
    err.length = 0;
    return main(argv, {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => (typeof stdin === "string" ? stdin : JSON.stringify(stdin)),
      ...(background_ === false
        ? {}
        : { spawnBackground: (args, input) => void background.push({ args, input }) }),
    });
  };
  return { home, repo, sent, out, err, background, run };
}

describe("prompt-submit hooks record the user's requests", () => {
  it("Claude Code: prints nothing (no context added), returns at once and records the prompt in the background", async () => {
    const t = setup();
    const input = {
      session_id: "s1",
      cwd: "",
      prompt: "Add a dark mode toggle",
      hook_event_name: "UserPromptSubmit",
    };
    input.cwd = t.repo;
    expect(await t.run(["hook", "prompt", "--agent", "claude"], input)).toBe(0);
    expect(t.out).toEqual([]);
    expect(t.sent).toEqual([]);
    expect(t.background).toEqual([
      { args: ["hook", "prompt", "--agent", "claude", "--worker"], input: JSON.stringify(input) },
    ]);
    const [job] = t.background;
    expect(await t.run(job?.args ?? [], job?.input ?? "")).toBe(0);
    expect(t.out).toEqual([]);
    expect(t.sent).toEqual([
      {
        path: "/api/hooks/proj-1/requests",
        method: "POST",
        body: { text: "Add a dark mode toggle", session_id: "s1" },
      },
    ]);
  });

  it("Cursor answers continue (never blocks), Codex prints nothing; both record with their session ids", async () => {
    const t = setup();
    expect(
      await t.run(["hook", "prompt", "--agent", "cursor", "--worker"], {
        conversation_id: "conv-9",
        workspace_roots: [t.repo],
        prompt: "Add search",
      }),
    ).toBe(0);
    expect(t.out.map((l) => JSON.parse(l))).toEqual([{ continue: true }]);
    expect(t.sent[0]?.body).toEqual({ text: "Add search", session_id: "conv-9" });
    expect(
      await t.run(["hook", "prompt", "--agent", "codex", "--worker"], {
        session_id: "019a",
        cwd: t.repo,
        prompt: "Add filters",
        turn_id: "t1",
      }),
    ).toBe(0);
    expect(t.out).toEqual([]);
    expect(t.sent[1]?.body).toEqual({ text: "Add filters", session_id: "019a" });
  });

  it("never records empty prompts, slash commands or Codeceipt's own commands", async () => {
    const t = setup();
    for (const prompt of [
      "",
      "   \n ",
      "/clear",
      "/codeceipt",
      "npx codeceipt",
      "codeceipt last",
      "  NPX Codeceipt receipt",
      "!codeceipt last",
    ]) {
      expect(
        await t.run(["hook", "prompt", "--agent", "claude"], {
          session_id: "s1",
          cwd: t.repo,
          prompt,
        }),
      ).toBe(0);
    }
    expect(t.background).toEqual([]);
    expect(t.sent).toEqual([]);
  });

  it("attack: secrets are masked and the text capped before anything leaves the machine; an unlinked folder sends nothing", async () => {
    const t = setup();
    const secret = ["sk_", "live_", "4eC39Hq", "LyjWDarj", "Ab12"].join("");
    await t.run(["hook", "prompt", "--agent", "claude", "--worker"], {
      session_id: "s1",
      cwd: t.repo,
      prompt: `use ${secret} ${"x".repeat(9000)}`,
    });
    const text = String(t.sent[0]?.body?.text);
    expect(text).not.toContain(secret);
    expect(text.length).toBeLessThanOrEqual(4000);
    const plain = mkdtempSync(join(tmpdir(), "cc-prompt-plain-"));
    t.sent.length = 0;
    expect(
      await t.run(["hook", "prompt", "--agent", "claude", "--worker"], {
        session_id: "s1",
        cwd: plain,
        prompt: "Add x",
      }),
    ).toBe(0);
    expect(t.sent).toEqual([]);
  });
});

describe("security pass: prompt hook", () => {
  it("attack: a cwd on stdin in another linked repo is ignored; the prompt goes to the hook's own project", async () => {
    const t = setup();
    const other = mkdtempSync(join(tmpdir(), "cc-prompt-other-"));
    execFileSync("git", ["init", "-q"], { cwd: other });
    linkRepo(other, join(t.home, ".config", "codeceipt", "config.json"), {
      apiUrl: "https://brain.test",
      projectId: "proj-other",
      token: TOKEN,
    });
    await t.run(["hook", "prompt", "--agent", "claude", "--worker"], {
      session_id: "s1",
      cwd: other,
      prompt: "Add a page",
    });
    expect(t.sent.map((s) => s.path)).toEqual(["/api/hooks/proj-1/requests"]);
  });
});

describe("receipts for the session's own requests; the session-end hook exits 0", () => {
  it("the receipt checks this session's request only, and the summary says how many files changed", async () => {
    const t = setup({
      sessionRequests: [{ id: "req-new", text: "Add search", items: [] }],
      requests: [{ id: "req-old", text: "Old", items: [{ text: "Old item", status: "open" }] }],
    });
    await t.run(["hook", "session-start", "--agent", "claude"], { session_id: "s1", cwd: t.repo });
    writeFileSync(join(t.repo, "app.ts"), "export const a = 2;\n");
    writeFileSync(join(t.repo, "search.ts"), "export const s = 1;\n");
    expect(
      await t.run(["hook", "session-end", "--agent", "claude"], { session_id: "s1", cwd: t.repo }),
    ).toBe(0);
    const openItems = t.sent.find((s) => s.path.endsWith("/open-items"));
    expect(openItems?.query).toMatch(/^\?session=s1&since=\d{4}-\d{2}-\d{2}T/);
    const receipts = t.sent.filter((s) => s.body?.name === "generate_receipt");
    expect(receipts.map((r) => (r.body?.arguments as { requestId?: string }).requestId)).toEqual([
      "req-new",
    ]);
    expect(t.err.slice(0, 3)).toEqual([
      "Codeceipt receipt: 2 files changed; 1 done, 0 missed.",
      "Checks needing attention: none.",
      "Full receipt: https://brain.test/projects/proj-1/receipts#receipt-rc-1",
    ]);
  });

  it("old open requests are never judged against a new session's changes: no session request means a no-request receipt", async () => {
    const t = setup({
      sessionRequests: [],
      requests: [{ id: "req-old", text: "Old", items: [{ text: "Old item", status: "open" }] }],
    });
    await t.run(["hook", "session-start", "--agent", "claude"], { session_id: "s2", cwd: t.repo });
    writeFileSync(join(t.repo, "app.ts"), "export const a = 3;\n");
    expect(
      await t.run(["hook", "session-end", "--agent", "claude"], { session_id: "s2", cwd: t.repo }),
    ).toBe(0);
    const receipt = t.sent.find((s) => s.body?.name === "generate_receipt");
    expect(receipt?.body?.arguments).not.toHaveProperty("requestId");
  });
});
