import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Deploy check (docs/deploy.md): no code the web server runs may load machine-only modules. PGlite and the
// @brain/sandbox child process run in tests and in the CLI; libpg-query (the Supabase migration reader) runs only in
// the CLI. Walks the real import graph from every server entry (routes, pages, layouts, instrumentation), following
// relative imports, the "@/" alias and the workspace packages; type-only imports load nothing and are skipped.

const web = fileURLToPath(new URL("../..", import.meta.url));
const root = join(web, "../..");
const PACKAGES: Record<string, string> = {
  "@brain/core": join(root, "packages/core/src/index.ts"),
  "@brain/db": join(root, "packages/db/src/index.ts"),
  "@brain/db/schema": join(root, "packages/db/src/schema/index.ts"),
};
const FORBIDDEN = [
  "@electric-sql/pglite",
  "drizzle-orm/pglite",
  "@brain/sandbox",
  "@brain/cli",
  "libpg-query",
  "@brain/db/testing",
  "@brain/core/supabase",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const isEntry = (p: string) =>
  /\/(route|page|layout|error|loading|not-found)\.tsx?$/.test(p) ||
  p.endsWith("/instrumentation.ts");
const entries = files(join(web, "src")).filter((p) => isEntry(p) && !p.includes(".test."));

function resolveFile(base: string): string | null {
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// Value imports and re-exports of a file (`import type` / `export type` load nothing at run time).
function specifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (const m of source.matchAll(re)) if (!m[2]) out.push(m[3] as string);
  for (const m of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1] as string);
  return out;
}

function walk(): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const specs = specifiers(readFileSync(file, "utf8"));
    seen.set(file, specs);
    for (const spec of specs) {
      let target: string | null = null;
      if (spec.startsWith(".")) target = resolveFile(join(dirname(file), spec));
      else if (spec.startsWith("@/")) target = resolveFile(join(web, "src", spec.slice(2)));
      else if (PACKAGES[spec]) target = PACKAGES[spec] as string;
      if (target && !target.endsWith(".mjs")) queue.push(target);
    }
  }
  return seen;
}

describe("deploy: the web server loads no machine-only code", () => {
  it("finds the server entries", () => {
    expect(entries.length).toBeGreaterThan(30);
    expect(entries.some((p) => p.endsWith("app/api/health/route.ts"))).toBe(true);
  });

  it("no server entry reaches PGlite, the sandbox, the CLI or libpg-query", () => {
    const graph = walk();
    const offenders = [...graph].flatMap(([file, specs]) =>
      specs
        .filter((s) => FORBIDDEN.some((f) => s === f || s.startsWith(`${f}/`)))
        .map((s) => `${relative(root, file)} imports ${s}`),
    );
    expect(offenders).toEqual([]);
    // The walk really crossed into the workspace packages (so an empty list means something).
    expect([...graph.keys()].some((f) => f.includes("packages/core/src/indexer"))).toBe(true);
    expect([...graph.keys()].some((f) => f.includes("packages/db/src/repos"))).toBe(true);
  });
});
