import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// `codeceipt last --evidence`: the code-free evidence the judge was given per file, read from the stored receipt. Only
// counts, flags, symbol-shaped names and known places are printed, whatever the server answers. Token built at
// runtime; control characters only as escapes.
const TOKEN = ["pb_", "live", "Z3kQ9", "wP2xR", "7mN4v"].join("");
const summary = {
  path: "src/app/page.tsx",
  added: 8,
  removed: 0,
  comment_only: true,
  imports_changed: false,
  symbols_added: [],
  symbols_removed: [],
  symbols_changed: [],
  where: ["top of file"],
};

function setup(receipt: unknown, argv = ["last", "--evidence"]) {
  const home = mkdtempSync(join(tmpdir(), "cc-ev-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-ev-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const fetchImpl: CliDeps["fetch"] = async () =>
    Response.json({
      ok: true,
      receipt_id: "rc-1",
      created_at: "2026-10-31T12:00:00.000Z",
      receipt,
    });
  const out: string[] = [];
  const run = () =>
    main(argv, {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: () => {},
      readStdin: async () => "",
    });
  return { run, out };
}

describe("codeceipt last --evidence", () => {
  it("prints each file's summary as the judge read it, after the receipt summary", async () => {
    const t = setup({
      items: [{ status: "done_untested" }],
      evidence: [
        { path: "src/app/page.tsx", in_scope: true, summary },
        {
          path: "src/lib/offline/sync.ts",
          in_scope: false,
          pre_existing: true,
          summary: {
            ...summary,
            path: "src/lib/offline/sync.ts",
            added: 2,
            comment_only: false,
            symbols_changed: ["sync"],
            where: ["lines 4-5"],
            since_session_start: true,
          },
        },
        { path: "public/logo.png", in_scope: false, summary: null },
      ],
    });
    expect(await t.run()).toBe(0);
    const at = t.out.indexOf("Evidence sent to the judge (no source code):");
    expect(at).toBeGreaterThan(0);
    expect(t.out.slice(at + 1)).toEqual([
      "  src/app/page.tsx: +8 -0, comment only, top of file (in the request's feature)",
      "  src/lib/offline/sync.ts: +2 -0, symbols changed: sync, lines 4-5 (outside the request's feature; already modified before the session, this session's edits only)",
      "  public/logo.png: no change summary (paths only)",
    ]);
  });

  it("an older receipt without stored evidence says so; plain `last` prints no evidence", async () => {
    const t = setup({ items: [] });
    await t.run();
    expect(t.out.at(-1)).toBe(
      "No evidence was stored with this receipt (it was made before receipts kept it).",
    );
    const plain = setup({ items: [], evidence: [{ path: "a.ts", in_scope: true, summary }] }, [
      "last",
    ]);
    await plain.run();
    expect(plain.out.join("\n")).not.toContain("Evidence sent");
  });

  it("attack: server text in paths, names or places never reaches the terminal raw, and odd values are dropped", async () => {
    const evil = "\u001b]8;;https://evil.test\u0007x\u001b]8;;\u0007";
    const t = setup({
      evidence: [
        { path: `src/${evil}.ts`, in_scope: true, summary },
        {
          path: "src/a.ts",
          in_scope: true,
          summary: {
            ...summary,
            symbols_added: [`a${evil}`, "ok"],
            where: [evil, "top of file"],
            added: 1e12,
          },
        },
        { path: "src/b.ts", in_scope: "yes", summary: "+999 -0, comment only" },
        ...Array.from({ length: 300 }, (_, i) => ({
          path: `f${i}.ts`,
          in_scope: true,
          summary: null,
        })),
      ],
    });
    await t.run();
    const all = t.out.join("\n");
    expect(all).not.toContain("evil.test");
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this looks for
    expect(all).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    expect(all).toContain("symbols added: ok, top of file");
    expect(all).not.toContain("+999");
    expect(t.out.filter((l) => l.startsWith("  ")).length).toBeLessThanOrEqual(201);
  });
});
