import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The client boundary (production bug, 2026-11-01): a server component called dayLabel(), a plain function exported
// from a "use client" module. Next.js hands the server a client reference instead, and the page crashed with "Attempted
// to call dayLabel() from the server but dayLabel is on the client". Rule: a file without "use client" may import from
// a "use client" module only components (PascalCase names) and the default export. Helpers and constants live in
// src/lib/ui-helpers.ts, which has no directive. Every file under src is checked, tests included.

type Source = { path: string; text: string };

const CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;
// PascalCase: starts with a capital, has a lowercase letter (so LIMIT, TICK_MS and STATES are constants).
const COMPONENT = /^[A-Z][A-Za-z0-9]*$/;
const isComponentName = (name: string) => COMPONENT.test(name) && /[a-z]/.test(name);

const isClientModule = (text: string) => CLIENT.test(text);

/** The value imports and re-exports of a file, as module specifier plus the names it takes. `import type` and
 * inline `type X` specifiers load nothing at run time and are skipped. "default" stands for the default export. */
function valueImports(text: string): { spec: string; names: string[]; namespace: boolean }[] {
  const out: { spec: string; names: string[]; namespace: boolean }[] = [];
  const re = /^[ \t]*(import|export)\s+([^;"']*?)\s*from\s*["']([^"']+)["']/gm;
  for (const m of text.matchAll(re)) {
    const clause = (m[2] ?? "").trim();
    if (/^type\s/.test(clause)) continue;
    const names: string[] = [];
    let namespace = false;
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const raw of (braces[1] ?? "").split(",")) {
        const item = raw.trim();
        if (!item || /^type\s/.test(item)) continue;
        names.push(item.split(/\s+as\s+/)[0] ?? item);
      }
    }
    const rest = clause
      .replace(/\{[^}]*\}/, "")
      .replace(/,/g, " ")
      .trim();
    if (/\*/.test(rest)) namespace = true;
    else if (m[1] === "import" && rest) names.push("default");
    out.push({ spec: m[3] as string, names, namespace });
  }
  return out;
}

/** Violations: a non-client file importing a non-component name, or a namespace, from a client module. */
function boundaryViolations(
  files: Source[],
  resolve: (fromPath: string, spec: string) => string | null,
): string[] {
  const byPath = new Map(files.map((f) => [f.path, f.text] as const));
  const found: string[] = [];
  for (const file of files) {
    if (isClientModule(file.text)) continue;
    for (const imp of valueImports(file.text)) {
      const target = resolve(file.path, imp.spec);
      if (!target) continue;
      const targetText = byPath.get(target);
      if (targetText === undefined || !isClientModule(targetText)) continue;
      if (imp.namespace) found.push(`${file.path} imports * from ${imp.spec}`);
      for (const name of imp.names) {
        if (name === "default" || isComponentName(name)) continue;
        found.push(`${file.path} imports ${name} from ${imp.spec} (a "use client" module)`);
      }
    }
  }
  return found;
}

const web = fileURLToPath(new URL("../..", import.meta.url));
const src = join(web, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

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

const resolveInApp = (fromPath: string, spec: string) => {
  if (spec.startsWith("@/")) return resolveFile(join(src, spec.slice(2)));
  if (spec.startsWith(".")) return resolveFile(join(dirname(fromPath), spec));
  return null;
};

describe("client boundary: server code imports only components from 'use client' modules", () => {
  it("the whole app passes (no server file calls a helper from a client module)", () => {
    const files = walk(src).map((path) => ({ path, text: readFileSync(path, "utf8") }));
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((f) => isClientModule(f.text)).length).toBeGreaterThan(20);
    const violations = boundaryViolations(files, resolveInApp).map((v) => relative(web, v));
    expect(violations).toEqual([]);
  });

  it("the receipts page no longer imports dayLabel from a client module", () => {
    const page = readFileSync(join(src, "app/projects/[id]/receipts/page.tsx"), "utf8");
    const names = valueImports(page).flatMap((i) => i.names);
    expect(names).toContain("dayLabel");
    expect(resolveInApp(join(src, "app/projects/[id]/receipts/page.tsx"), "@/lib/ui-helpers")).toBe(
      join(src, "lib/ui-helpers.ts"),
    );
    expect(isClientModule(readFileSync(join(src, "lib/ui-helpers.ts"), "utf8"))).toBe(false);
  });

  it("attack: a server file importing a helper from a 'use client' module is caught", () => {
    const client = [
      '"use client";',
      "export function dayLabel(createdAt: string) { return createdAt; }",
      "export function Feed() { return null; }",
    ].join("\n");
    const page = [
      'import { Feed, dayLabel } from "@/components/feed";',
      'export default function Page() { return dayLabel("x"); }',
    ].join("\n");
    const found = boundaryViolations(
      [
        { path: "/app/page.tsx", text: page },
        { path: "/app/components/feed.tsx", text: client },
      ],
      (_from, spec) => (spec === "@/components/feed" ? "/app/components/feed.tsx" : null),
    );
    expect(found).toEqual([
      '/app/page.tsx imports dayLabel from @/components/feed (a "use client" module)',
    ]);
  });

  it("attack: a namespace import, a renamed helper and a default-import chain are caught too", () => {
    const client = ['"use client";', "export const TICK = 1;", "export function helper() {}"].join(
      "\n",
    );
    const resolve = (_f: string, spec: string) => (spec === "./m" ? "/x/m.tsx" : null);
    const ns = ['import * as M from "./m";', "export const y = M.helper();"].join("\n");
    const renamed = ['import { helper as h } from "./m";', "export const z = h();"].join("\n");
    const reexport = ['export { helper } from "./m";'].join("\n");
    const run = (text: string) =>
      boundaryViolations(
        [
          { path: "/x/page.tsx", text },
          { path: "/x/m.tsx", text: client },
        ],
        resolve,
      );
    expect(run(ns)).toEqual(["/x/page.tsx imports * from ./m"]);
    expect(run(renamed)).toEqual(['/x/page.tsx imports helper from ./m (a "use client" module)']);
    expect(run(reexport)).toEqual(['/x/page.tsx imports helper from ./m (a "use client" module)']);
  });

  it("attack: a constant from a client module is caught, a PascalCase component and type imports are allowed", () => {
    const client = [
      '"use client";',
      "export const LIMIT = 3;",
      "export type Shape = { id: string };",
      "export function Card() {}",
    ].join("\n");
    const resolve = (_f: string, spec: string) => (spec === "./m" ? "/x/m.tsx" : null);
    const run = (text: string) =>
      boundaryViolations(
        [
          { path: "/x/page.tsx", text },
          { path: "/x/m.tsx", text: client },
        ],
        resolve,
      );
    expect(run(['import { LIMIT } from "./m";'].join("\n"))).toEqual([
      '/x/page.tsx imports LIMIT from ./m (a "use client" module)',
    ]);
    expect(
      run(['import { Card, type Shape } from "./m";', "export default Card;"].join("\n")),
    ).toEqual([]);
    expect(run(['import type { Shape } from "./m";'].join("\n"))).toEqual([]);
    expect(run(['import Card2 from "./m";'].join("\n"))).toEqual([]);
  });

  it("the directive is read only from the top of the file, not from a string inside it", () => {
    expect(isClientModule('"use client";\nexport const a = 1;')).toBe(true);
    expect(isClientModule("// header\n'use client';\n")).toBe(true);
    expect(isClientModule('const s = "use client";')).toBe(false);
  });
});
