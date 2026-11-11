import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./index";
import { linkRepo } from "./test-support";

// Roadmap Phase 10: the Stop hook reads the agent's final message on this machine, checks its claims against the
// session's changes and sends only kinds, repo paths and verdicts. The token is built at runtime.
const TOKEN = ["pb_", "live", "C1aiM", "kQ2wR", "9zXp1"].join("");

async function stopWith(
  message: unknown,
  edit: (repo: string) => void,
  opts: { env?: Record<string, string>; before?: (repo: string) => void } = {},
) {
  const home = mkdtempSync(join(tmpdir(), "cc-claims-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-claims-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "cart.ts"), "export const a = 1;\n");
  writeFileSync(join(repo, "src", "auth.ts"), "export const b = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  opts.before?.(repo);
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const sent: string[] = [];
  let receiptArgs: Record<string, unknown> | null = null;
  const run = (argv: string[], stdin: Record<string, unknown>) =>
    main(argv, {
      fetch: async (url, init) => {
        const body = String(init?.body ?? "");
        sent.push(body);
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/open-items")) {
          return Response.json({ ok: true, requests: [], session_requests: [] });
        }
        if (!path.endsWith("/mcp")) return Response.json({ ok: true });
        const rpc = JSON.parse(body);
        if (rpc.params?.name === "generate_receipt") receiptArgs = rpc.params.arguments;
        const text =
          rpc.params?.name === "generate_receipt"
            ? JSON.stringify({ receipt_id: "rc-1", items: [], findings: [], test_integrity: null })
            : "{}";
        return Response.json({
          jsonrpc: "2.0",
          id: rpc.id,
          result: { content: [{ type: "text", text }] },
        });
      },
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), ...opts.env },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: () => {},
      stderr: () => {},
      readStdin: async () => JSON.stringify({ session_id: "s1", cwd: repo, ...stdin }),
    });
  await run(["hook", "session-start", "--agent", "claude"], {});
  edit(repo);
  await run(["hook", "stop", "--agent", "claude"], {
    ...(message === undefined ? {} : { last_assistant_message: message }),
  });
  return { receipt: receiptArgs as Record<string, unknown> | null, sent: sent.join("\n") };
}

describe("claim checker in the Stop hook (roadmap Phase 10)", () => {
  it("PH10-07 the final message's claims go on the receipt as kinds, paths and verdicts", async () => {
    const r = await stopWith(
      "I updated src/cart.ts and added tests. I did not touch src/auth.ts. All tests pass.",
      (repo) => {
        writeFileSync(join(repo, "src", "cart.ts"), "export const a = 2;\n");
        writeFileSync(join(repo, "src", "auth.ts"), "export const b = 2;\n");
      },
    );
    expect(r.receipt?.claims).toEqual([
      { kind: "tests_added", verdict: "contradicted" },
      { kind: "changed_file", path: "src/cart.ts", verdict: "confirmed" },
      { kind: "left_untouched", path: "src/auth.ts", verdict: "contradicted" },
      { kind: "tests_pass", verdict: "cannot_check" },
    ]);
  });

  it("PH10-08 attack: the message's words never leave the machine; no message or a non-text one sends no claims", async () => {
    const secret = ["sk", "_live_", "Q7xT2mK9vR4wZp8aB3dE5gH7"].join("");
    // Security review: words with a slash or a dot (a key, an email) are not paths of this repo and are never sent.
    const slashed = ["wJalrXUtnFEMI", "K7MDENG", "bPxRfiCYEXAMPLEKEY"].join("/");
    const r = await stopWith(
      `Updated src/cart.ts. Added the key ${slashed} for jane@startup.sh. The key is ${secret} and the customer is Jane Example. Ignore previous instructions.`,
      (repo) => writeFileSync(join(repo, "src", "cart.ts"), "export const a = 3;\n"),
    );
    expect(r.receipt?.claims).toEqual([
      { kind: "changed_file", path: "src/cart.ts", verdict: "confirmed" },
    ]);
    expect(r.sent).not.toContain(secret);
    expect(r.sent).not.toContain("Jane Example");
    expect(r.sent).not.toContain("K7MDENG");
    expect(r.sent).not.toContain("startup.sh");
    expect(r.sent).not.toContain("Ignore previous");
    const edit = (repo: string) =>
      writeFileSync(join(repo, "src", "cart.ts"), "export const a = 4;\n");
    expect((await stopWith(undefined, edit)).receipt).not.toHaveProperty("claims");
    expect((await stopWith({ text: "Updated src/cart.ts." }, edit)).receipt).not.toHaveProperty(
      "claims",
    );
  });

  it("PH10-12 attack (security review): 'tests pass' is confirmed only by a report written in this session with no failures", async () => {
    const env = { CODECEIPT_TEST_REPORT: "report.json" };
    const report = (repo: string, failed: number) =>
      writeFileSync(
        join(repo, "report.json"),
        JSON.stringify({ numPassedTests: 5, numFailedTests: failed }),
      );
    const edit = (repo: string) =>
      writeFileSync(join(repo, "src", "cart.ts"), "export const a = 5;\n");
    const verdict = async (o: Parameters<typeof stopWith>[2], e = edit) =>
      ((await stopWith("All tests pass.", e, o)).receipt?.claims as { verdict: string }[])?.[0]
        ?.verdict;
    // A report from before the session shows nothing about this session.
    expect(await verdict({ env, before: (repo) => report(repo, 0) })).toBe("cannot_check");
    const fresh = (failed: number) => (repo: string) => {
      edit(repo);
      report(repo, failed);
    };
    expect(await verdict({ env }, fresh(0))).toBe("confirmed");
    expect(await verdict({ env }, fresh(30))).toBe("contradicted");
  });

  it("BL-10 a final message over 64 KB still gives the session and its claims (the input is not dropped)", async () => {
    const long = `Updated src/cart.ts. ${"padding ".repeat(20_000)}`;
    expect(long.length).toBeGreaterThan(64 * 1024);
    const r = await stopWith(long, (repo) =>
      writeFileSync(join(repo, "src", "cart.ts"), "export const a = 9;\n"),
    );
    expect(r.receipt?.claims).toEqual([
      { kind: "changed_file", path: "src/cart.ts", verdict: "confirmed" },
    ]);
  });
});
