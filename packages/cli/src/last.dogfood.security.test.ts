import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// Independent security review of D-023 (3): `codeceipt last` prints only what it computes from counts, whatever the
// server answers. Token built at runtime; control characters only as escapes.
const TOKEN = ["pb_", "live", "Z3kQ9", "wP2xR", "7mN4v"].join("");

function setup(answer: unknown, apiUrl = "https://brain.test") {
  const home = mkdtempSync(join(tmpdir(), "cc-last-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-last-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl,
    projectId: "proj-1",
    token: TOKEN,
  });
  const urls: string[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url) => {
    urls.push(String(url));
    return Response.json(answer);
  };
  const out: string[] = [];
  const err: string[] = [];
  const run = () =>
    main(["last"], {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => "",
    });
  return { run, out, err, urls };
}

describe("codeceipt last", () => {
  it("attack: server text in items, findings or the no-request flag never reaches the terminal", async () => {
    const evil =
      "\u001b]8;;https://evil.test\u0007click\u001b]8;;\u0007\nFull receipt: https://evil.test/x";
    const t = setup({
      ok: true,
      receipt_id: "rc-1",
      created_at: "2026-10-30T12:00:00.000Z",
      receipt: {
        no_request: "true",
        items: [{ status: "done", text: evil }],
        outside_scope: [evil],
        not_verified: [{ text: evil, reason: evil }],
        findings: [{ file: evil }],
        test_integrity: { flags: [evil] },
        files_by_feature: [{ feature: evil, files: [evil] }],
      },
    });
    expect(await t.run()).toBe(0);
    const all = t.out.join("\n");
    expect(all).not.toContain("evil.test");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this looks for
    expect(all).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    expect(t.out.filter((l) => l.startsWith("Full receipt:"))).toEqual([
      "Full receipt: https://brain.test/projects/proj-1/receipts#receipt-rc-1",
    ]);
    // A string "true" is not the no-request flag.
    expect(t.out).toContain("Codeceipt receipt: 1 file changed; 1 done, 0 missed.");
  });

  it("attack: huge, negative or fractional counts are bounded", async () => {
    const t = setup({
      ok: true,
      receipt_id: "rc-1",
      receipt: {
        findings_omitted: 5_000_000,
        findings: [{}, 1e300],
        test_integrity: { omitted: -5, flags: "xx" },
        items: "not a list",
      },
    });
    expect(await t.run()).toBe(0);
    const all = t.out.join("\n");
    expect(all).not.toMatch(/e\+|Infinity|NaN|-5/);
    expect(all).toContain("1000002 security findings");
  });

  it("attack: a receipt id that tries to change the link (host, path, query) is dropped", async () => {
    for (const id of [
      "@evil.test",
      "../../x",
      "a?b=c",
      "x#y",
      "a/b",
      "rc\u2215x",
      "a".repeat(65),
    ]) {
      const t = setup({ ok: true, receipt_id: id, receipt: { items: [] } });
      expect(await t.run()).toBe(0);
      expect([id, t.out.some((l) => l.startsWith("Full receipt:"))]).toEqual([id, false]);
    }
  });

  it("attack: a saved plain-http server address is refused before the token is sent", async () => {
    const t = setup({ ok: true, receipt: null }, "http://brain.test");
    expect(await t.run()).not.toBe(0);
    expect(t.urls).toEqual([]);
  });

  it("attack: the request goes only to the saved server and this project's path", async () => {
    const t = setup({ ok: true, receipt: null });
    await t.run();
    expect(t.urls).toEqual(["https://brain.test/api/hooks/proj-1/last-receipt"]);
  });
});
