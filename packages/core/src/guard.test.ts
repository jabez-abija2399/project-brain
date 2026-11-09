import { describe, expect, it } from "vitest";
import { guardCheck, newLines, newPackageNames } from "./guard";
import { findHiddenChars } from "./hidden-chars";

// Invisible and lookalike characters are written as \u escapes; fake secrets are built at run time.
const RLO = "\u202e";
// A skipped test inside a fixture, built at run time so the kit's diff check does not read it as one of ours.
const SKIPPED = ["it", "skip"].join(".");
const ZWSP = "\u200b";
const TAG_A = "\u{e0061}";
const CYRILLIC_A = "\u0430";
const fakeKey = () => ["sk", "_live_", "4eC39HqLyjWDarjtT1zdp7dc"].join("");

describe("Codeceipt Guard (roadmap Phase 5)", () => {
  it("PH5-01 hidden characters: bidi controls, zero-width marks, tag characters and mixed-script words", () => {
    const text = [
      "const ok = 1;",
      `const admin = "user${RLO}";`,
      `const a${ZWSP}b = 2;`,
      `// hi${TAG_A}`,
      `const p${CYRILLIC_A}ssword = 3;`,
      "const \u043f\u0440\u0438\u0432\u0435\u0442 = 4;",
    ].join("\n");
    expect(findHiddenChars(text)).toEqual([
      { line: 2, kind: "bidi", code: "U+202E" },
      { line: 3, kind: "invisible", code: "U+200B" },
      { line: 4, kind: "tag", code: "U+E0061" },
      { line: 5, kind: "lookalike", code: "U+0430" },
    ]);
  });

  it("PH5-02 emoji sequences, a leading byte-order mark and plain non-Latin words are not flagged", () => {
    const family = "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}";
    const heart = "\u2764\ufe0f";
    expect(
      findHiddenChars(
        `\ufeffconst x = "${family} ${heart}";\nconst \u540d\u524d = "\u65e5\u672c";`,
      ),
    ).toEqual([]);
  });

  it("PH5-03 only lines the change added are checked", () => {
    expect(newLines("a\nb\nb", "a\nb\nc\nb\nb")).toEqual(new Set([3, 5]));
    expect(newLines(null, "x\ny")).toEqual(new Set([1, 2]));
  });

  it("PH5-04 weakened tests, secrets, hidden characters and size limits, each with a plain fix", () => {
    const findings = guardCheck({
      files: [
        {
          path: "src/a.test.ts",
          before:
            'it("adds", () => { expect(1).toBe(1); });\nit("subtracts", () => { expect(0).toBe(0); });',
          after: `${SKIPPED}("adds", () => { expect(1).toBe(1); });`,
        },
        { path: "src/old.test.ts", before: 'it("x", () => {});', after: null },
        {
          path: "src/config.ts",
          before: "export const a = 1;",
          after: `export const key = "${fakeKey()}";`,
        },
        { path: "src/b.ts", before: null, after: `const x = "${RLO}";` },
        { path: "public/big.bin", before: null, after: null, tooLarge: true },
      ],
    });
    const rules = findings.map((f) => `${f.rule} ${f.file}`);
    expect(rules).toEqual([
      "test_file_deleted src/old.test.ts",
      "tests_deleted src/a.test.ts",
      "tests_skipped src/a.test.ts",
      "assertions_removed src/a.test.ts",
      "secret src/config.ts",
      "hidden_character src/b.ts",
      "file_too_large public/big.bin",
    ]);
    for (const f of findings) {
      expect(f.what.length).toBeGreaterThan(0);
      expect(f.fix.length).toBeGreaterThan(0);
    }
    const secret = findings.find((f) => f.rule === "secret");
    expect(secret?.line).toBe(1);
    expect(JSON.stringify(findings)).not.toContain(fakeKey());
  });

  it("PH5-05 a secret or hidden character that was already there before the change is not reported", () => {
    const old = `export const key = "${fakeKey()}";\nconst y = "${RLO}";`;
    expect(
      guardCheck({ files: [{ path: "src/c.ts", before: old, after: `${old}\nconst z = 1;` }] }),
    ).toEqual([]);
  });

  it("PH5-06 protected paths and package boundaries from the Blueprint", () => {
    const findings = guardCheck({
      files: [{ path: "supabase/migrations/02.sql", before: null, after: "select 1;" }],
      dependencies: ["lodash"],
      boundaries: [
        { kind: "protected_path", pattern: "supabase/migrations/**" },
        { kind: "disallowed_dependency", pattern: "lodash" },
      ],
    });
    expect(findings.map((f) => f.rule)).toEqual(["protected_path", "disallowed_dependency"]);
    expect(findings[0]?.fix).toContain("owner");
  });

  it("PH5-07 added dependencies are read from package.json sections by name only", () => {
    const before = JSON.stringify({ dependencies: { react: "^18" } });
    const after = JSON.stringify({
      dependencies: { react: "^18", dayjs: "^1" },
      devDependencies: { vitest: "^2" },
      scripts: { evil: "curl x" },
    });
    expect(newPackageNames(before, after)).toEqual(["dayjs", "vitest"]);
    expect(newPackageNames(null, "not json")).toEqual([]);
  });

  it("PH5-08 attack: hostile file names and test names are cleaned and findings are capped", () => {
    const files = Array.from({ length: 300 }, (_, i) => ({
      path: `src/f${i}${RLO}.ts`,
      before: null,
      after: `const a = "${ZWSP}";`,
    }));
    const findings = guardCheck({ files });
    expect(findings.length).toBeLessThanOrEqual(100);
    for (const f of findings) expect(f.file).not.toContain(RLO);
  });

  it("PH5-18 a variation selector from the supplement (used to hide data) is flagged; an emoji style selector is not", () => {
    expect(findHiddenChars("const a = 1;\u{e0100}")).toEqual([
      { line: 1, kind: "invisible", code: "U+E0100" },
    ]);
    expect(findHiddenChars('const ok = "\u2764\ufe0f";')).toEqual([]);
  });
});
