import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// Journey part 4: the session-end hook ends with a 3-line receipt summary (done, missed, checks needing attention)
// and a link to the full receipt. The token is built at runtime.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");

function setup(receipt: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "cc-sum-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-sum-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  writeFileSync(join(repo, "README.md"), "# app\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/open-items")) {
      return Response.json({
        ok: true,
        requests: [
          {
            id: "req-1",
            text: "Add a star rating",
            items: [{ text: "Show the average", status: "done" }],
          },
        ],
      });
    }
    const body = JSON.parse(String(init?.body));
    const name = body.params.name;
    const text = name === "generate_receipt" ? JSON.stringify(receipt) : "{}";
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: { content: [{ type: "text", text }] },
    });
  };
  const err: string[] = [];
  const end = async () => {
    writeFileSync(join(repo, "StarRating.tsx"), "export const StarRating = () => null;\n");
    return main(["hook", "session-end", "--agent", "claude"], {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: () => {},
      stderr: (l) => err.push(l),
      readStdin: async () => JSON.stringify({ session_id: "s1", cwd: repo }),
    });
  };
  return { err, end };
}

const item = (text: string, status: string) => ({ id: text, text, status, evidence: [] });

describe("session-end receipt summary", () => {
  it("prints done, missed and checks needing attention in 3 lines, with a link to the full receipt", async () => {
    const t = setup({
      receipt_id: "rc-1",
      items: [item("Add the StarRating component", "done"), item("Show the average", "missed")],
      outside_scope: [],
      not_verified: [],
      findings: [],
      findings_omitted: 0,
      test_integrity: null,
    });
    // Exit 2 is how Claude Code shows a session-end hook's message to the user.
    expect(await t.end()).toBe(2);
    expect(t.err.slice(0, 3)).toEqual([
      "Codeceipt receipt: 1 done, 1 missed.",
      "Checks needing attention: none.",
      "Full receipt: https://brain.test/projects/proj-1/receipts#receipt-rc-1",
    ]);
  });

  it("counts partly done items as missed and names the checks that need attention", async () => {
    const t = setup({
      receipt_id: "rc-2",
      items: [item("A", "done"), item("B", "partial"), item("C", "done")],
      outside_scope: ["src/billing/Invoice.tsx"],
      not_verified: [{ id: null, text: "Runs on Safari", reason: "no browser" }],
      findings: [{ kind: "secret" }, { kind: "rls" }],
      findings_omitted: 1,
      test_integrity: { flags: [{ kind: "test_deleted" }], omitted: 0 },
    });
    await t.end();
    expect(t.err.slice(0, 3)).toEqual([
      "Codeceipt receipt: 2 done, 1 missed (1 partly done).",
      "Checks needing attention: 3 security findings, 1 test check, 1 file outside the request, 1 not verified.",
      "Full receipt: https://brain.test/projects/proj-1/receipts#receipt-rc-2",
    ]);
  });

  it("attack: a receipt answer with odd ids, huge counts or terminal escapes never changes the link or reaches the terminal raw", async () => {
    const t = setup({
      receipt_id: "../../evil\u001b]8;;https://evil.test\u0007",
      items: Array.from({ length: 5000 }, (_, i) => item(`x${i}\u001b[2J`, "done")),
      findings: "lots",
      test_integrity: { flags: "x" },
    });
    await t.end();
    const all = t.err.join("\n");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this looks for
    expect(all).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
    expect(all).not.toContain("evil.test");
    expect(t.err[0]).toBe("Codeceipt receipt: 5000 done, 0 missed.");
    expect(t.err.some((l) => l.startsWith("Full receipt:"))).toBe(false);
  });
});
