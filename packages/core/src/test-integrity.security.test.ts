// FEAT-018 /security pass: an agent trying to game the tests without being flagged, and a user who must not get false
// alarms. Each test performs the attack and asserts the intended behaviour.
import { describe, expect, it } from "vitest";
import { checkTestIntegrity, isTestConfig, isTestFile } from "./test-integrity";

// Skip/focus markers in fixtures are joined at runtime so the kit's skip guard does not read them as skipped tests.
const D = ".";
const X = "x";

const path = "src/cart/cart.test.ts";
const suite = (cases: string[]) =>
  [
    'import { describe, expect, it } from "vitest";',
    'describe("cart", () => {',
    ...cases,
    "});",
  ].join("\n");
const ADD = 'it("adds an item", () => {\n  expect(add(1)).toBe(1);\n});';
const TOTAL = 'it("sums the total", () => {\n  expect(total([1, 2])).toBe(3);\n});';
const EMPTY = "it('rejects an empty cart', () => {\n  expect(() => pay([])).toThrow();\n});";
const BASE = suite([ADD, TOTAL, EMPTY]);

const kinds = (flags: ReturnType<typeof checkTestIntegrity>) => flags.map((f) => f.kind);
const names = (flags: ReturnType<typeof checkTestIntegrity>) => flags.flatMap((f) => f.names);
const check = (before: string | null, after: string | null, p = path) =>
  checkTestIntegrity([{ path: p, before, after }]);

describe("FEAT-018 security: test integrity evasions (core)", () => {
  it("AC-018-02 attack: commenting a test out (// lines or a /* */ block) is flagged, not read as a live test", () => {
    const lineComment = suite([
      ADD,
      TOTAL,
      EMPTY.split("\n")
        .map((l) => `// ${l}`)
        .join("\n"),
    ]);
    const blockComment = suite([ADD, TOTAL, `/*\n${EMPTY}\n*/`]);
    for (const after of [lineComment, blockComment]) {
      const flags = check(BASE, after);
      expect(flags.length).toBeGreaterThan(0);
      expect(names(flags).join(" ")).toContain("rejects an empty cart");
    }
  });

  it("AC-018-02 attack: a removed expect() hidden by a decoy expect( in a comment or string is still flagged", () => {
    const after = suite([
      ADD,
      'it("sums the total", () => {\n  // expect(total([1, 2])).toBe(3);\n  total([1, 2]);\n});',
      EMPTY,
    ]);
    expect(kinds(check(BASE, after))).toContain("removed_assertions");
    const inString = suite([
      ADD,
      'it("sums the total", () => {\n  const why = "expect(total) was flaky";\n  total([1, 2]);\n});',
      EMPTY,
    ]);
    expect(kinds(check(BASE, inString))).toContain("removed_assertions");
  });

  it("AC-018-01 attack: deleting a test while adding a describe wrapper or a trivial new test (same case count) is flagged with the removed name", () => {
    // The agent deletes "rejects an empty cart" and groups the rest under a new describe: the count stays 4.
    const wrapped = suite([`describe("basics", () => {\n${ADD}\n${TOTAL}\n});`]).replace(
      "  expect(add(1)).toBe(1);",
      "  expect(add(1)).toBe(1);\n  expect(() => pay([])).toThrow;",
    );
    // Or replaces it by a vacuous test that keeps both the case count and the expect() count.
    const swapped = suite([ADD, TOTAL, 'it("works", () => {\n  expect(true).toBe(true);\n});']);
    for (const after of [wrapped, swapped]) {
      const flags = check(BASE, after);
      expect(kinds(flags)).toContain("deleted_tests");
      expect(names(flags)).toContain("rejects an empty cart");
    }
  });

  it("AC-018-02 attack: vitest option forms ({ skip: true }, { only: true }, { todo: true }) and a bare ctx.skip call are flagged", () => {
    const variants = [
      EMPTY.replace("'rejects an empty cart', ", "'rejects an empty cart', { skip: true }, "),
      EMPTY.replace("'rejects an empty cart', ", "'rejects an empty cart', { only: true }, "),
      EMPTY.replace("'rejects an empty cart', ", "'rejects an empty cart', { todo: true }, "),
      EMPTY.replace("() => {\n", `(ctx) => {\n  ctx${D}skip();\n`),
    ];
    for (const v of variants) {
      const flags = check(BASE, suite([ADD, TOTAL, v]));
      expect(kinds(flags), v).toContain("skipped_tests");
    }
  });

  it("AC-018-02 attack: skipIf, runIf, describe.skip, test.todo, it.concurrent.skip and xdescribe all raise a flag naming the test", () => {
    const variants: [string, string][] = [
      [EMPTY.replace("it(", `it${D}skipIf(true)(`), "rejects an empty cart"],
      [EMPTY.replace("it(", "it.runIf(false)("), "rejects an empty cart"],
      [EMPTY.replace("it(", `it.concurrent${D}skip(`), "rejects an empty cart"],
      [EMPTY.replace("it(", "test.todo("), "rejects an empty cart"],
    ];
    for (const [v, name] of variants) {
      const flags = check(BASE, suite([ADD, TOTAL, v]));
      expect(names(flags).join(" "), v).toContain(name);
    }
    for (const outer of [`describe${D}skip(`, `${X}describe(`]) {
      const flags = check(BASE, BASE.replace("describe(", outer));
      expect(kinds(flags), outer).toContain("skipped_tests");
      expect(names(flags).join(" ")).toContain("cart");
    }
  });

  it("AC-018-02 attack: .skip/.only on a call whose name prettier wrapped to the next line is flagged", () => {
    const long = "rejects an empty cart and shows the empty-state message to the customer";
    const before = suite([
      ADD,
      `it(\n  "${long}",\n  () => {\n    expect(() => pay([])).toThrow();\n  },\n);`,
    ]);
    const after = before.replace("it(\n", `it${D}skip(\n`);
    const flags = check(before, after);
    expect(kinds(flags)).toContain("skipped_tests");
    expect(names(flags).join(" ")).toContain(long);
  });

  it("AC-018-04 attack (false alarm): renaming a test to a longer name that prettier wraps is not flagged as deleted", () => {
    const before = suite([ADD, TOTAL, EMPTY]);
    const after = suite([
      ADD,
      TOTAL,
      "it(\n  'rejects an empty cart and shows the empty-state message to the customer',\n  () => {\n    expect(() => pay([])).toThrow();\n  },\n);",
    ]);
    expect(check(before, after)).toEqual([]);
  });

  it("AC-018-01 attack: deleting a multi-line test.each table is flagged with its test name", () => {
    const table =
      'test.each([\n  [1, 1],\n  [2, 2],\n])("adds %i", (n, out) => {\n  expect(add(n)).toBe(out);\n});';
    const flags = check(suite([ADD, table]), suite([ADD]));
    expect(kinds(flags)).toContain("deleted_tests");
    expect(names(flags)).toContain("adds %i");
  });

  it("AC-018-02 attack: .only padded onto a line longer than the parser's line cap is still flagged", () => {
    const pad = ` /* ${"x".repeat(2_100)} */`;
    const after = suite([
      ADD,
      TOTAL,
      EMPTY,
      `it${D}only("smoke", () => { expect(1).toBe(1); });${pad}`,
    ]);
    expect(kinds(check(BASE, after))).toContain("skipped_tests");
  });

  it("AC-018-02 attack: focusing through an alias or bracket access is flagged", () => {
    const alias = suite([
      ADD,
      TOTAL,
      EMPTY,
      'const focus = it.only;\nfocus("smoke", () => {\n  expect(1).toBe(1);\n});',
    ]);
    const bracket = suite([
      ADD,
      TOTAL,
      EMPTY,
      'it["only"]("smoke", () => {\n  expect(1).toBe(1);\n});',
    ]);
    for (const after of [alias, bracket])
      expect(kinds(check(BASE, after))).toContain("skipped_tests");
  });

  it("AC-018-02 attack: removing assert-style assertions (vitest assert, node:assert, chai) is flagged", () => {
    const before = suite([
      'it("sums the total", () => {\n  assert.equal(total([1, 2]), 3);\n  assert(total([]) === 0);\n});',
    ]);
    const after = suite(['it("sums the total", () => {\n  total([1, 2]);\n});']);
    expect(kinds(check(before, after))).toContain("removed_assertions");
  });

  it("AC-018-01 attack: Cypress *.cy.ts specs are test files, and common layouts (.test.mts, .spec.cjs, __tests__) are too", () => {
    for (const p of ["src/a.test.mts", "src/a.spec.cjs", "src/__tests__/a.ts", "tests/a.ts"]) {
      expect(isTestFile(p), p).toBe(true);
    }
    expect(isTestFile("cypress/e2e/checkout.cy.ts")).toBe(true);
  });

  it("AC-018-01 attack: tests moved to a non-test path are flagged as a deleted test file", () => {
    const flags = checkTestIntegrity([
      { path, before: BASE, after: null },
      { path: "src/cart/cart.helpers.ts", before: null, after: BASE },
    ]);
    expect(flags).toEqual([
      {
        kind: "deleted_test_file",
        file: path,
        names: ["cart", "adds an item", "sums the total", "rejects an empty cart"],
        count: 4,
      },
    ]);
  });

  it("AC-018-04 attack (false alarm): moving a test file unchanged to a new test path is not flagged", () => {
    const flags = checkTestIntegrity([
      { path, before: BASE, after: null },
      { path: "src/checkout/cart.test.ts", before: null, after: BASE },
    ]);
    expect(flags).toEqual([]);
  });

  it("AC-018-03 attack: exclude/include changes in vite.config, vitest.workspace and vitest.config.mts are flagged", () => {
    const before =
      'export default defineConfig({\n  test: {\n    include: ["src/**/*.test.ts"],\n  },\n});';
    const after = before.replace(
      'include: ["src/**/*.test.ts"],',
      'include: ["src/**/*.test.ts"],\n    exclude: ["src/cart/**"],',
    );
    for (const p of [
      "vite.config.ts",
      "vitest.workspace.ts",
      "apps/web/vitest.config.mts",
      "vitest.config.e2e.ts",
    ]) {
      expect(isTestConfig(p), p).toBe(true);
      expect(kinds(check(before, after, p)), p).toEqual(["test_config_changed"]);
    }
  });

  it("AC-018-03 attack: other selection keys (dir, root, projects, testNamePattern, grep, grepInvert, testPathPattern, roots) are flagged", () => {
    const before = "export default defineConfig({\n  test: {\n    globals: true,\n  },\n});";
    const lines = [
      'dir: "src/other",',
      'root: "packages/empty",',
      'projects: ["packages/empty"],',
      'testNamePattern: "^smoke",',
      "grep: /@smoke/,",
      "grepInvert: /@slow/,",
      'testPathPattern: "smoke",',
      'roots: ["<rootDir>/empty"],',
    ];
    for (const l of lines) {
      const after = before.replace("globals: true,", `globals: true,\n    ${l}`);
      expect(kinds(check(before, after, "vitest.config.ts")), l).toEqual(["test_config_changed"]);
    }
  });

  it("AC-018-03 attack: an entry added inside an existing multi-line exclude array is flagged", () => {
    const before =
      'export default defineConfig({\n  test: {\n    exclude: [\n      "node_modules/**",\n      "dist/**",\n    ],\n  },\n});';
    const after = before.replace('"dist/**",', '"dist/**",\n      "src/cart/**",');
    expect(kinds(check(before, after, "vitest.config.ts"))).toEqual(["test_config_changed"]);
  });

  it("AC-018-03 attack: an exclude list changed through a variable on another line is flagged", () => {
    const before =
      "const skipped: string[] = [];\nexport default defineConfig({\n  test: {\n    exclude: [...configDefaults.exclude, ...skipped],\n  },\n});";
    const after = before.replace(
      "const skipped: string[] = [];",
      'const skipped: string[] = ["src/cart/**"];',
    );
    expect(kinds(check(before, after, "vitest.config.ts"))).toEqual(["test_config_changed"]);
  });

  it("AC-018-03 attack: an exclude added on a line padded past the line cap is flagged", () => {
    const before = "export default defineConfig({ test: { globals: true } });";
    const after = `export default defineConfig({ test: { globals: true, exclude: ["src/cart/**"] } }); /* ${"x".repeat(2_100)} */`;
    expect(kinds(check(before, after, "vitest.config.ts"))).toEqual(["test_config_changed"]);
  });

  it("AC-018-03 attack: jest/vitest config in package.json (jest key, test script flags), jest.config.json and vitest.workspace.json is flagged", () => {
    const pkg = (jest: string, script: string) =>
      `{\n  "name": "shop",\n  "scripts": {\n    "test": "${script}"\n  },\n  "jest": ${jest}\n}`;
    const before = pkg("{}", "vitest run");
    const cases: [string, string, string][] = [
      ["package.json", before, pkg('{ "testPathIgnorePatterns": ["/cart/"] }', "vitest run")],
      ["package.json", before, pkg("{}", "vitest run --exclude src/cart/**")],
      ["package.json", before, pkg("{}", "vitest run --passWithNoTests src/smoke")],
      ["jest.config.json", "{}", '{ "testPathIgnorePatterns": ["/cart/"] }'],
      ["vitest.workspace.json", '["packages/*"]', '["packages/empty"]'],
    ];
    for (const [p, b, a] of cases) {
      expect(isTestConfig(p) || isTestFile(p), p).toBe(true);
      expect(kinds(check(b, a, p)), `${p}: ${a}`).toEqual(["test_config_changed"]);
    }
  });

  it("AC-018-04 attack (false alarm): coverage.exclude and optimizeDeps.include changes in a vite/vitest config are not flagged", () => {
    const before =
      'export default defineConfig({\n  optimizeDeps: {\n    include: ["react"],\n  },\n  test: {\n    coverage: {\n      exclude: ["**/*.d.ts"],\n    },\n  },\n});';
    const after = before
      .replace('include: ["react"]', 'include: ["react", "react-dom"]')
      .replace('exclude: ["**/*.d.ts"]', 'exclude: ["**/*.d.ts", "src/generated/**"]');
    expect(check(before, after, "vite.config.ts")).toEqual([]);
  });

  it("AC-018-04 attack (false alarm): reordering, splitting a test, a helper keeping the expect count, CRLF, template names and test.each tables are not flagged", () => {
    const tmpl = "it(`totals ${'EUR'} prices`, () => {\n  expect(total([1])).toBe(1);\n});";
    const each =
      'test.each([[add(1), 1], [add(2), 2]])("adds %i", (a, b) => {\n  expect(a).toBe(b);\n});';
    const before = suite([ADD, TOTAL, EMPTY, tmpl, each]);
    // Reordered.
    expect(check(before, suite([EMPTY, tmpl, each, TOTAL, ADD]))).toEqual([]);
    // CRLF line endings.
    expect(check(before, before.replace(/\n/g, "\r\n"))).toEqual([]);
    // One test split into two, each with its own assertion.
    const split = suite([
      ADD,
      'it("sums the total", () => {\n  expect(total([1, 2])).toBe(3);\n});\nit("sums an empty cart", () => {\n  expect(total([])).toBe(0);\n});',
      EMPTY,
      tmpl,
      each,
    ]);
    expect(check(before, split)).toEqual([]);
    // Assertions moved into a helper in the same file, keeping their number.
    const helper = suite([
      "const expectAdds = (n: number) => {\n  expect(add(n)).toBe(n);\n};",
      'it("adds an item", () => {\n  expectAdds(1);\n});',
      TOTAL,
      EMPTY,
      tmpl,
      each,
    ]);
    expect(check(before, helper)).toEqual([]);
  });

  it("AC-018-01 attack: a code snippet or a long string used as a test name is capped, and at most 20 names are reported", () => {
    // Under the 2,000-character line cap, so it is parsed.
    const longName = `fetch(${"x".repeat(1_500)})`;
    const many = Array.from(
      { length: 60 },
      (_, i) => `it("case ${i}", () => {\n  expect(${i}).toBe(${i});\n});`,
    );
    const before = suite([`it("${longName}", () => {});`, ...many]);
    const [flag] = check(before, null);
    expect(flag?.kind).toBe("deleted_test_file");
    expect(flag?.count).toBe(62);
    expect(flag?.names.length).toBeLessThanOrEqual(20);
    for (const n of flag?.names ?? []) expect(n.length).toBeLessThanOrEqual(200);
  });

  it("AC-018-01 attack: big test files (about 1 MB, tens of thousands of distinct test names on both sides) are checked quickly", () => {
    const build = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `it("${prefix}${i}", () => {});`).join("\n");
    // Before: 28,000 tests; after: 27,000 different tests. One line each, just under 1 MB (MAX_SCAN_BYTES) per side.
    const before = build("before case ", 28_000);
    const after = build("after case ", 27_000);
    expect(before.length).toBeLessThan(1024 * 1024);
    const started = Date.now();
    const flags = check(before, after);
    const ms = Date.now() - started;
    expect(flags[0]).toMatchObject({ kind: "deleted_tests", count: 1_000 });
    // Parsing this takes about 0.1 s; the quadratic name diff (indexOf + splice per name) takes several seconds, and
    // the hook has 60 s for up to 200 such files plus every server call.
    expect(ms).toBeLessThan(2_000);
  });

  it("AC-018-02 attack: ReDoS-shaped lines (unclosed quotes, many calls, huge each() tables) stay linear", () => {
    const line = `${'it("'.repeat(400)}${"\\".repeat(399)}`;
    const each = `test.each(${"(".repeat(1_900)}`;
    const text = Array.from({ length: 500 }, (_, i) => (i % 2 ? line : each)).join("\n");
    const started = Date.now();
    check(text, `${text}\nit${D}skip("x", () => {});`);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
