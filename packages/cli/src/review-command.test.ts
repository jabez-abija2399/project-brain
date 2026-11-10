import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./index";

// Roadmap Phase 7: `codeceipt review` on a real git repo. Offline: nothing is fetched or sent.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "cc-review-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: dir,
    }).toString();
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "src/api"), { recursive: true });
  writeFileSync(join(dir, "src/app.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  return { dir, git };
}

async function run(cwd: string, argv: string[]) {
  const home = mkdtempSync(join(tmpdir(), "cc-home-"));
  const out: string[] = [];
  const err: string[] = [];
  let fetched = 0;
  const code = await main(argv, {
    fetch: async () => {
      fetched += 1;
      throw new Error("offline");
    },
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    cwd,
    homedir: home,
    platform: "linux",
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    readStdin: async () => "",
  });
  return { code, text: out.join("\n"), err: err.join("\n"), fetched };
}

const long = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n")}\n`;

describe("codeceipt review (roadmap Phase 7)", () => {
  it("PH7-10 lists the checklist rules a new API route touches and flags a long file; exit 0, nothing fetched", async () => {
    const { dir } = repo();
    writeFileSync(
      join(dir, "src/api/route.ts"),
      "export async function GET() {\n  for (const x of [1]) void x;\n}\n",
    );
    writeFileSync(join(dir, "src/app.ts"), long(320));
    const r = await run(dir, ["review"]);
    expect(r.code).toBe(0);
    expect(r.fetched).toBe(0);
    expect(r.text).toContain("Codeceipt review: 2 changed files (uncommitted changes).");
    expect(r.text).toContain("! src/app.ts: 321 lines (over 300)");
    expect(r.text).toContain("[ ] 1. Every query and route is scoped by project");
    expect(r.text).toContain("[ ] 4. Every input, list, loop and AI call has a cap.");
    expect(r.text).toContain("Files: src/api/route.ts");
    expect(r.text).toContain("nothing was sent");
  });

  it("PH7-11 --staged reads only staged files; --json gives the same answer as data", async () => {
    const { dir, git } = repo();
    writeFileSync(join(dir, "src/api/route.ts"), "export const x = 1;\n");
    git("add", "src/api/route.ts");
    writeFileSync(join(dir, "src/app.ts"), long(320));
    const r = await run(dir, ["review", "--staged", "--json"]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.text) as {
      source: string;
      files: number;
      checklist: { id: number; files: string[] }[];
      maintainability: unknown[];
    };
    expect(data.source).toBe("staged");
    expect(data.files).toBe(1);
    expect(data.checklist).toEqual([
      expect.objectContaining({ id: 1, files: ["src/api/route.ts"] }),
    ]);
    expect(data.maintainability).toEqual([]);
  });

  it("PH7-12 no changes: one line; bad arguments: usage and exit 2", async () => {
    const { dir } = repo();
    const r = await run(dir, ["review"]);
    expect(r.text).toBe("Codeceipt review: 0 changed files (uncommitted changes).");
    const bad = await run(dir, ["review", "--staged", "--ci"]);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("Usage: codeceipt review");
    const dash = await run(dir, ["review", "--ci", "--base", "--output=/tmp/x"]);
    expect(dash.code).toBe(2);
  });

  it("PH7-13 attack: a symlink to a file outside the repo is never read", async () => {
    const { dir } = repo();
    const outside = mkdtempSync(join(tmpdir(), "cc-outside-"));
    writeFileSync(join(outside, "secret.ts"), long(400));
    symlinkSync(join(outside, "secret.ts"), join(dir, "src/api/linked.ts"));
    const r = await run(dir, ["review", "--json"]);
    const data = JSON.parse(r.text) as { maintainability: unknown[]; checklist: unknown[] };
    expect(data.maintainability).toEqual([]);
    expect(data.checklist).toEqual([]);
  });
});
