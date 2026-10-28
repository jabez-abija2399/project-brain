import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { indexRepo, indexSources } from "./index";
import { walkRepo } from "./walker";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
  "tests/fixtures/component-app",
);

describe("indexSources (FEAT-009 in-memory indexing)", () => {
  it("AC-009-05 indexes files held in memory exactly like indexRepo indexes them on disk", async () => {
    const onDisk = await indexRepo(fixtureRoot);
    const files = walkRepo(fixtureRoot).files.map((f) => ({
      path: f.relPath,
      content: readFileSync(f.absPath),
    }));
    let tsconfig: string | null = null;
    try {
      tsconfig = readFileSync(join(fixtureRoot, "tsconfig.json"), "utf8");
    } catch {
      tsconfig = null;
    }
    const inMemory = indexSources(files, { knownPaths: files.map((f) => f.path), tsconfig });

    expect(inMemory.files).toEqual(onDisk.files);
    expect(inMemory.components).toEqual(onDisk.components);
    expect(inMemory.routes).toEqual(onDisk.routes);
    // Imports resolved against the known paths, not the disk: at least one repo import resolves.
    expect(inMemory.files.some((f) => f.imports.some((i) => i.resolved !== null))).toBe(true);
  });

  it("AC-009-05 skips excluded folders, unsupported, binary and oversized files like the walker", () => {
    const text = (s: string) => Buffer.from(s, "utf8");
    const binary = Buffer.from([0x65, 0x00, 0x66]);
    const result = indexSources(
      [
        { path: "src/App.tsx", content: text("export function App() { return <div />; }") },
        { path: "node_modules/pkg/index.js", content: text("module.exports = 1;") },
        { path: "README.md", content: text("# readme") },
        { path: "src/blob.ts", content: binary },
        { path: "src/huge.ts", content: text("x".repeat(50)) },
      ],
      { knownPaths: [], maxFileBytes: 45 },
    );
    expect(result.files.map((f) => f.path)).toEqual(["src/App.tsx"]);
    expect(Object.fromEntries(result.skipped.map((s) => [s.path, s.reason]))).toEqual({
      "node_modules/pkg/index.js": "excluded_dir",
      "README.md": "unsupported_ext",
      "src/blob.ts": "binary",
      "src/huge.ts": "too_large",
    });
  });

  it("AC-009-05 an import of a path that is not in knownPaths stays unresolved (no disk lookup)", () => {
    const result = indexSources(
      [{ path: "src/a.ts", content: Buffer.from('import { b } from "./b";\nexport const a = b;') }],
      { knownPaths: ["src/a.ts"] },
    );
    expect(result.files[0]?.imports[0]?.resolved).toBeNull();
    const withB = indexSources(
      [{ path: "src/a.ts", content: Buffer.from('import { b } from "./b";\nexport const a = b;') }],
      { knownPaths: ["src/a.ts", "src/b.ts"] },
    );
    expect(withB.files[0]?.imports[0]?.resolved).toBe("src/b.ts");
  });
});
