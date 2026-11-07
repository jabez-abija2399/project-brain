// @slow: builds the CLI bundle
// Roadmap Phase 2b: hooks start fast because the bundle's start-up path never loads the heavy packages; only the
// commands that need them (index, rls) load them on demand. Checked on the built bundle: every file reachable through
// static imports from codeceipt.mjs.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build.mjs";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const HEAVY = ["typescript", "ignore", "libpg-query", "@electric-sql/pglite"];
let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(join(pkgDir, ".startup-build-"));
  await build({ outDir });
}, 60_000);
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

// Static imports only (import ... from "x" and import "x"); dynamic import("x") is the on-demand path.
function staticImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/^\s*(?:import\s[^;]*?from\s*|import\s*)"([^"]+)";?/gm)].map(
    (m) => m[1] as string,
  );
}

describe("Phase 2b: fast start-up", () => {
  it("PERF-2B-07 nothing on the start-up path loads typescript, ignore, libpg-query or pglite", () => {
    const seen = new Set<string>();
    const heavy: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of staticImports(file)) {
        if (spec.startsWith(".")) visit(join(dirname(file), spec));
        else if (HEAVY.includes(spec)) heavy.push(`${file.slice(outDir.length)} -> ${spec}`);
      }
    };
    visit(join(outDir, "codeceipt.mjs"));
    expect(seen.size).toBeGreaterThan(1);
    expect(heavy).toEqual([]);
  });
});
