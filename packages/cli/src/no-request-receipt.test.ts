import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// Dogfooding (edutech): a session that changed files always gets a receipt, even with no request; and the latest
// receipt can be printed again with `codeceipt last` (Claude Code does not show a SessionEnd hook's output after
// exit). The token is built at runtime.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");
const NO_REQUEST =
  "No request was recorded for this session, so nothing could be checked against what you asked.";

type Call = { path: string; tool?: string; args?: Record<string, unknown> };

function setup(
  opts: { requests?: unknown[]; last?: unknown; receipt?: Record<string, unknown> } = {},
) {
  const home = mkdtempSync(join(tmpdir(), "cc-noreq-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-noreq-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  mkdirSync(join(repo, "src", "app"), { recursive: true });
  writeFileSync(join(repo, "src", "app", "page.tsx"), "export default function Page() {}\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const calls: Call[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/open-items")) {
      calls.push({ path });
      return Response.json({ ok: true, requests: opts.requests ?? [] });
    }
    if (path.endsWith("/last-receipt")) {
      calls.push({ path });
      return Response.json({ ok: true, ...((opts.last as object) ?? { receipt: null }) });
    }
    const body = JSON.parse(String(init?.body));
    const { name, arguments: args } = body.params;
    calls.push({ path, tool: name, args });
    const text =
      name === "generate_receipt"
        ? JSON.stringify(
            opts.receipt ?? {
              receipt_id: "rc-9",
              request_id: null,
              no_request: true,
              items: [],
              outside_scope: [],
              not_verified: [],
              findings: [],
              findings_omitted: 0,
              test_integrity: null,
            },
          )
        : "{}";
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: { content: [{ type: "text", text }] },
    });
  };
  const out: string[] = [];
  const err: string[] = [];
  const run = (argv: string[], stdin = JSON.stringify({ session_id: "s1", cwd: repo })) => {
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
      readStdin: async () => stdin,
    });
  };
  return { repo, calls, out, err, run };
}

describe("a session with changes always gets a receipt", () => {
  it("no request recorded: the changed files still go to generate_receipt (no requestId) and the summary says why nothing was checked", async () => {
    const t = setup();
    await t.run(["hook", "session-start", "--agent", "claude"]);
    writeFileSync(
      join(t.repo, "src", "app", "page.tsx"),
      "export default function Page() { return 1; }\n",
    );
    expect(await t.run(["hook", "session-end", "--agent", "claude"])).toBe(0);
    const receipt = t.calls.find((c) => c.tool === "generate_receipt");
    expect(receipt?.args?.changedFiles).toEqual(["src/app/page.tsx"]);
    expect(receipt?.args).not.toHaveProperty("requestId");
    expect(t.err.slice(0, 3)).toEqual([
      `Codeceipt receipt: 1 file changed. ${NO_REQUEST}`,
      "Checks needing attention: none.",
      "Full receipt: https://brain.test/projects/proj-1/receipts#receipt-rc-9",
    ]);
    expect(t.calls.some((c) => c.tool === "save_progress")).toBe(true);
  });

  it("a session without changes sends no receipt", async () => {
    const t = setup();
    await t.run(["hook", "session-start", "--agent", "claude"]);
    await t.run(["hook", "session-end", "--agent", "claude"]);
    expect(t.calls.some((c) => c.tool === "generate_receipt")).toBe(false);
  });
});

describe("codeceipt last", () => {
  it("prints the latest receipt's summary and link", async () => {
    const t = setup({
      last: {
        receipt_id: "rc-7",
        created_at: "2026-10-30T12:00:00.000Z",
        receipt: {
          items: [
            { id: "a", text: "x", status: "done" },
            { id: "b", text: "y", status: "missed" },
          ],
          outside_scope: [],
          not_verified: [],
          findings: [],
          test_integrity: null,
        },
      },
    });
    expect(await t.run(["last"], "")).toBe(0);
    expect(t.out).toEqual([
      "Latest receipt (2026-10-30 12:00 UTC):",
      "Codeceipt receipt: 1 done, 1 missed.",
      "Checks needing attention: none.",
      "Full receipt: https://brain.test/projects/proj-1/receipts#receipt-rc-7",
      // Real-test C (2026-11-01): what needs attention is named, not only counted.
      "Needs attention:",
      "  - Missed: y",
    ]);
  });

  it("says so when there is no receipt yet", async () => {
    const t = setup();
    expect(await t.run(["last"], "")).toBe(0);
    expect(t.out).toEqual(["No receipt yet: make a change with your agent and end the session."]);
  });

  it("attack: a stored receipt with odd ids or terminal escapes never changes the link or reaches the terminal raw", async () => {
    const t = setup({
      last: {
        receipt_id: "../x\u001b]8;;https://evil.test\u0007",
        created_at: "\u001b[2Jnot a date",
        receipt: { items: [{ status: "done", text: "\u001b[31mred" }] },
      },
    });
    expect(await t.run(["last"], "")).toBe(0);
    const all = t.out.join("\n");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this looks for
    expect(all).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
    expect(all).not.toContain("evil.test");
    expect(t.out).toContain("Codeceipt receipt: 1 done, 0 missed.");
  });
});
