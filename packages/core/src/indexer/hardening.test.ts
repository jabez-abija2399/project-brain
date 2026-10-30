import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexRepo } from "./index";

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "brain-indexer-hardening-"));
  temps.push(dir);
  return dir;
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("indexRepo stays inside the repo root", () => {
  it("never follows symlinked folders or files and lists them as skipped", async () => {
    const outside = tempDir();
    writeTree(outside, {
      "ServerOnly.tsx": "export function ServerOnly() { return <div/>; }\n",
    });
    const repo = tempDir();
    writeTree(repo, { "src/Ok.tsx": "export function Ok() { return <div/>; }\n" });
    symlinkSync(outside, join(repo, "src", "link"));
    symlinkSync(join(outside, "ServerOnly.tsx"), join(repo, "src", "File.tsx"));
    symlinkSync(repo, join(repo, "src", "loop"));

    const result = await indexRepo(repo);

    expect(result.files.map((f) => f.path)).toEqual(["src/Ok.tsx"]);
    expect(result.components.map((c) => c.name)).toEqual(["Ok"]);
    expect(JSON.stringify(result)).not.toContain("ServerOnly");
    const skipped = new Map(result.skipped.map((s) => [s.path, s.reason]));
    expect(skipped.get("src/link")).toBe("symlink");
    expect(skipped.get("src/File.tsx")).toBe("symlink");
    expect(skipped.get("src/loop")).toBe("symlink");
  });

  it("records imports that resolve outside the repo root as outside, with no path", async () => {
    const outside = tempDir();
    writeTree(outside, { "probe.ts": "export const x = 1;\n", "lib/shared.ts": "export {};\n" });
    const repo = tempDir();
    const up = "../".repeat(12);
    const outsideRel = `${up}${outside.replace(/^\//, "")}`;
    writeTree(repo, {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@ext/*": [`${outsideRel}/lib/*`] } },
      }),
      "src/a.ts": [
        `import x from "${outsideRel}/probe";`,
        'import y from "@ext/shared";',
        'import z from "./link/probe";',
        'import w from "./b";',
        "",
      ].join("\n"),
      "src/b.ts": "export default 1;\n",
    });
    symlinkSync(outside, join(repo, "src", "link"));

    const result = await indexRepo(repo);
    const imports = result.files.find((f) => f.path === "src/a.ts")?.imports ?? [];
    const byTo = new Map(imports.map((i) => [i.to, i]));

    const rel = byTo.get(`${outsideRel}/probe`);
    expect(rel?.resolved).toBeNull();
    expect(rel?.outside).toBe(true);
    const alias = byTo.get("@ext/shared");
    expect(alias?.resolved).toBeNull();
    expect(alias?.outside).toBe(true);
    expect(byTo.get("./link/probe")?.resolved).toBeNull();
    expect(byTo.get("./b")?.resolved).toBe("src/b.ts");
    expect(byTo.get("./b")?.outside).toBe(false);
    const serialized = JSON.stringify(
      result.files.flatMap((f) => f.imports.map((i) => i.resolved)),
    );
    expect(serialized).not.toContain("..");
    expect(serialized).not.toContain(outside);
  });
});

describe("indexRepo follows .gitignore semantics", () => {
  it("handles anchored patterns, negation, slashes, dir-only rules and nested .gitignore files", async () => {
    const repo = tempDir();
    const comp = "export const v = 1;\n";
    writeTree(repo, {
      ".gitignore": [
        "/config.ts",
        "*.gen.ts",
        "!keep.gen.ts",
        "docs/*.ts",
        "tmp/",
        "!tmp/x.ts",
      ].join("\n"),
      "config.ts": comp,
      "src/config.ts": comp,
      "src/a.gen.ts": comp,
      "src/keep.gen.ts": comp,
      "docs/a.ts": comp,
      "src/docs/a.ts": comp,
      "tmp/x.ts": comp,
      "src/feature/.gitignore": "local.ts\n/anchored.ts\n",
      "src/feature/local.ts": comp,
      "src/feature/sub/local.ts": comp,
      "src/feature/anchored.ts": comp,
      "src/feature/sub/anchored.ts": comp,
      "src/local.ts": comp,
    });

    const result = await indexRepo(repo);
    const indexed = result.files.map((f) => f.path);
    const reasons = new Map(result.skipped.map((s) => [s.path, s.reason]));

    expect(indexed).toEqual([
      "src/config.ts",
      "src/docs/a.ts",
      "src/feature/sub/anchored.ts",
      "src/keep.gen.ts",
      "src/local.ts",
    ]);
    for (const p of [
      "config.ts",
      "src/a.gen.ts",
      "docs/a.ts",
      "tmp",
      "src/feature/local.ts",
      "src/feature/sub/local.ts",
      "src/feature/anchored.ts",
    ]) {
      expect(reasons.get(p), p).toBe("gitignored");
    }
  });
});

describe("indexRepo honors .codeceiptignore and the legacy .projectbrainignore", () => {
  it("skips paths matched by a legacy .projectbrainignore (gitignore syntax, nested files, negation)", async () => {
    const repo = tempDir();
    const comp = "export function C() { return <div/>; }\n";
    writeTree(repo, {
      ".projectbrainignore": "tests/fixtures/\n*.stories.tsx\n!src/Keep.stories.tsx\n",
      "tests/fixtures/app/src/Fake.tsx": comp,
      "tests/unit/Real.tsx": comp,
      "src/Button.tsx": comp,
      "src/Button.stories.tsx": comp,
      "src/Keep.stories.tsx": comp,
      "src/legacy/.projectbrainignore": "Old.tsx\n",
      "src/legacy/Old.tsx": comp,
      "src/legacy/New.tsx": comp,
    });

    const result = await indexRepo(repo);
    const reasons = new Map(result.skipped.map((s) => [s.path, s.reason]));

    expect(result.files.map((f) => f.path)).toEqual([
      "src/Button.tsx",
      "src/Keep.stories.tsx",
      "src/legacy/New.tsx",
      "tests/unit/Real.tsx",
    ]);
    for (const p of ["tests/fixtures", "src/Button.stories.tsx", "src/legacy/Old.tsx"]) {
      expect(reasons.get(p), p).toBe("codeceiptignored");
    }
  });

  it("D-019 .codeceiptignore works the same, alongside a legacy .projectbrainignore, and wins where both disagree", async () => {
    const repo = tempDir();
    const comp = "export function C() { return <div/>; }\n";
    writeTree(repo, {
      ".projectbrainignore": "old/\nShared.tsx\n",
      ".codeceiptignore": "new/\n!Shared.tsx\n",
      "old/A.tsx": comp,
      "new/B.tsx": comp,
      "src/Shared.tsx": comp,
      "src/Kept.tsx": comp,
    });
    const result = await indexRepo(repo);
    expect(result.files.map((f) => f.path)).toEqual(["src/Kept.tsx", "src/Shared.tsx"]);
    const reasons = new Map(result.skipped.map((s) => [s.path, s.reason]));
    expect([reasons.get("old"), reasons.get("new")]).toEqual([
      "codeceiptignored",
      "codeceiptignored",
    ]);
  });
});

describe("indexRepo detects common React component shapes", () => {
  it("finds conditional, forwardRef, memo, class and default-exported components, and nothing else", async () => {
    const repo = tempDir();
    writeTree(repo, {
      "src/shapes.tsx": [
        'import * as React from "react";',
        'import { forwardRef, memo } from "react";',
        "export function Toggle({ on }: { on: boolean }) { return on ? <b /> : <i />; }",
        "export function Maybe({ show }: { show: boolean }) { return show && <p />; }",
        "export const Input = forwardRef<HTMLInputElement, { label: string }>((props, ref) => <input ref={ref} />);",
        "export const Row = memo(function Row({ id }: { id: string }) { return <tr />; });",
        "export const Fancy = React.memo(React.forwardRef((p: { x: number }, ref) => (<div />)));",
        "export class Legacy extends React.Component<{ title: string }> { render() { return <h1 />; } }",
        "export class Store { render() { return 1; } }",
        "export function helper() { return 1; }",
        "export const NotComp = (a: number) => a + 1;",
        "export const Wrapped = memo(helper);",
        "",
      ].join("\n"),
      "src/anon.tsx": "export default function () { return <main />; }\n",
      "src/panel.tsx":
        'import { memo } from "react";\nexport default memo(function Panel() { return <aside />; });\n',
    });

    const result = await indexRepo(repo);
    const names = result.components.map((c) => c.name).sort();
    expect(names).toEqual(
      ["Fancy", "Input", "Legacy", "Maybe", "Panel", "Row", "Toggle", "default"].sort(),
    );
    const byName = new Map(result.components.map((c) => [c.name, c]));
    expect(byName.get("Toggle")?.props).toContain("on");
    expect(byName.get("Row")?.props).toContain("id");
    expect(byName.get("Legacy")?.props).toContain("title");
    expect(byName.get("default")?.path).toBe("src/anon.tsx");
    expect(byName.get("Panel")?.path).toBe("src/panel.tsx");
  });
});

describe("indexRepo import graph", () => {
  it("records re-exports and dynamic imports, and treats tsconfig aliases as internal", async () => {
    const repo = tempDir();
    writeTree(repo, {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      "src/B.ts": "export const b = 1;\nexport type T = number;\n",
      "src/C.ts": "export const c = 1;\n",
      "src/index.ts": [
        'export { b } from "./B";',
        'export * from "./C";',
        'export type { T } from "./B";',
        "export const local = 1;",
        "",
      ].join("\n"),
      "src/page.tsx": [
        'import dynamic from "lazy-loader";',
        'import { c } from "@/C";',
        'const lazy = import("./B");',
        'const D = dynamic(() => import("@/C"));',
        "const name = './B';",
        "const notStatic = import(name);",
        "",
      ].join("\n"),
    });

    const result = await indexRepo(repo);
    const importsOf = (p: string) =>
      (result.files.find((f) => f.path === p)?.imports ?? []).map((i) => ({
        to: i.to,
        resolved: i.resolved,
        external: i.external,
      }));

    expect(importsOf("src/index.ts")).toEqual([
      { to: "./B", resolved: "src/B.ts", external: false },
      { to: "./C", resolved: "src/C.ts", external: false },
      { to: "./B", resolved: "src/B.ts", external: false },
    ]);
    expect(importsOf("src/page.tsx")).toEqual([
      { to: "lazy-loader", resolved: null, external: true },
      { to: "@/C", resolved: "src/C.ts", external: false },
      { to: "./B", resolved: "src/B.ts", external: false },
      { to: "@/C", resolved: "src/C.ts", external: false },
    ]);
  });
});

describe("KI-036 nested tsconfig.json files stay inside the repo root", () => {
  it("never reads a tsconfig reached through an extends outside the repo, a symlink or a cycle", async () => {
    const outside = tempDir();
    writeTree(outside, {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@x/*": ["./*"] } } }),
      "probe.ts": "export const x = 1;\n",
    });
    const repo = tempDir();
    const up = "../".repeat(14);
    writeTree(repo, {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@root/*": ["./lib/*"] } } }),
      "lib/r.ts": "export const r = 1;\n",
      // a relative extends that climbs out of the repo, and an absolute one
      "apps/up/tsconfig.json": JSON.stringify({
        extends: `${up}${outside.replace(/^\//, "")}/tsconfig.json`,
      }),
      "apps/up/a.ts": 'import { x } from "@x/probe";\n',
      "apps/abs/tsconfig.json": JSON.stringify({ extends: join(outside, "tsconfig.json") }),
      "apps/abs/a.ts": 'import { x } from "@x/probe";\n',
      // extends cycle: a -> b -> a; a's own paths still apply
      "apps/cycle/tsconfig.json": JSON.stringify({
        extends: "./b.json",
        compilerOptions: { paths: { "@c/*": ["./src/*"] } },
      }),
      "apps/cycle/b.json": JSON.stringify({ extends: "./tsconfig.json" }),
      "apps/cycle/src/c.ts": "export const c = 1;\n",
      "apps/cycle/a.ts": 'import { c } from "@c/c";\n',
      "apps/link/a.ts": 'import { x } from "@x/probe";\nimport { r } from "@root/r";\n',
    });
    // a symlinked nested tsconfig is skipped; the next one up (the root's) applies
    symlinkSync(join(outside, "tsconfig.json"), join(repo, "apps", "link", "tsconfig.json"));

    const result = await indexRepo(repo);
    const importsOf = (p: string) =>
      (result.files.find((f) => f.path === p)?.imports ?? []).map((i) => [
        i.to,
        i.resolved,
        i.outside,
        i.external,
      ]);

    expect(importsOf("apps/up/a.ts")).toEqual([["@x/probe", null, false, true]]);
    expect(importsOf("apps/abs/a.ts")).toEqual([["@x/probe", null, false, true]]);
    expect(importsOf("apps/cycle/a.ts")).toEqual([["@c/c", "apps/cycle/src/c.ts", false, false]]);
    expect(importsOf("apps/link/a.ts")).toEqual([
      ["@x/probe", null, false, true],
      ["@root/r", "lib/r.ts", false, false],
    ]);
    expect(JSON.stringify(result)).not.toContain("probe.ts");
  });
});
