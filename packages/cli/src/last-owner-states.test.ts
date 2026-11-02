import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// Known gap of PR #36 (fixed here): `codeceipt last` must show an item the owner closed as "Closed by you" and an item
// the owner dismissed as "Dismissed", never as "missed". The server says which item ids are owner-closed or dismissed.
const TOKEN = ["pb_", "live", "Q7wZ2", "kLm9x", "Tr4bn"].join("");

function setup(answer: unknown) {
  const home = mkdtempSync(join(tmpdir(), "cc-owner-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-owner-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const fetchImpl: CliDeps["fetch"] = async () => Response.json(answer);
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
  return { run, out, err };
}

const items = [
  { id: "i-closed", status: "missed", text: "Add a comment at the top" },
  { id: "i-dismissed", status: "missed", text: "Remove the banner" },
  { id: "i-open", status: "missed", text: "Fix the footer" },
];

describe("codeceipt last: owner-closed and dismissed items", () => {
  it("shows an owner-closed item as 'Closed by you' and a dismissed item as 'Dismissed', not as missed", async () => {
    const t = setup({
      ok: true,
      receipt_id: "rc-1",
      created_at: "2026-11-02T12:00:00.000Z",
      owner_closed_ids: ["i-closed"],
      dismissed_ids: ["i-dismissed"],
      receipt: { items },
    });
    await t.run();
    expect(t.out).toContain("Closed by you: Add a comment at the top");
    expect(t.out).toContain("Dismissed: Remove the banner");
    // Only the item nobody closed or dismissed is still missed.
    expect(t.out.some((l) => l.includes("1 missed"))).toBe(true);
    expect(t.out.some((l) => l.includes("3 missed") || l.includes("2 missed"))).toBe(false);
    expect(t.out.join("\n")).not.toMatch(/Add a comment[^\n]*missed/);
    expect(t.out.join("\n")).not.toMatch(/Remove the banner[^\n]*missed/);
  });

  it("with no owner states, the same receipt still shows every item as missed", async () => {
    const t = setup({ ok: true, receipt_id: "rc-1", receipt: { items } });
    await t.run();
    expect(t.out.some((l) => l.includes("3 missed"))).toBe(true);
    expect(t.out.join("\n")).not.toContain("Closed by you");
  });

  it("attack: owner-state ids that are not plain ids are ignored and never reach the terminal", async () => {
    const evil = "\u001b]8;;https://evil.test\u0007x\u0007";
    const t = setup({
      ok: true,
      receipt_id: "rc-1",
      owner_closed_ids: [evil, 42, null],
      dismissed_ids: [evil],
      receipt: { items },
    });
    await t.run();
    const all = [...t.out, ...t.err].join("\n");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this looks for
    expect(all).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
    expect(all).not.toContain("Closed by you");
    expect(all).not.toContain("evil.test");
    expect(t.out.some((l) => l.includes("3 missed"))).toBe(true);
  });
});
