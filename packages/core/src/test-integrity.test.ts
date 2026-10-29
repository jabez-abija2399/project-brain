import { describe, expect, it } from "vitest";
import { checkTestIntegrity } from "./test-integrity";

const suite = (cases: string[]) =>
  [
    'import { describe, expect, it } from "vitest";',
    'describe("cart", () => {',
    ...cases,
    "});",
  ].join("\n");
const ADD = 'it("adds an item", () => {\n  expect(add(1)).toBe(1);\n});';
const TOTAL =
  'it("sums the total", () => {\n  expect(total([1, 2])).toBe(3);\n  expect(total([])).toBe(0);\n});';
const EMPTY = "it('rejects an empty cart', () => {\n  expect(() => pay([])).toThrow();\n});";
const path = "src/cart/cart.test.ts";

describe("test integrity (FEAT-018)", () => {
  it("AC-018-01 a deleted test file and a deleted test case are flagged with file and test names", () => {
    const before = suite([ADD, TOTAL, EMPTY]);
    expect(checkTestIntegrity([{ path, before, after: null }])).toEqual([
      {
        kind: "deleted_test_file",
        file: path,
        names: ["cart", "adds an item", "sums the total", "rejects an empty cart"],
        count: 4,
      },
    ]);
    const flags = checkTestIntegrity([{ path, before, after: suite([ADD, TOTAL]) }]);
    expect(flags).toEqual([
      { kind: "deleted_tests", file: path, names: ["rejects an empty cart"], count: 1 },
      { kind: "removed_assertions", file: path, names: [], count: 1 },
    ]);
  });

  it("AC-018-02 attack: adding .skip, .only, xit or fdescribe, or removing expect() calls, is flagged", () => {
    const before = suite([ADD, TOTAL, EMPTY]);
    const after = suite([
      ADD.replace("it(", "it.skip("),
      TOTAL.replace("it(", "it.only(").replace("  expect(total([])).toBe(0);\n", ""),
      EMPTY.replace("it(", "xit("),
    ]).replace('describe("cart"', 'fdescribe("cart"');
    expect(checkTestIntegrity([{ path, before, after }])).toEqual([
      {
        kind: "skipped_tests",
        file: path,
        names: [
          "only: cart",
          "skip: adds an item",
          "only: sums the total",
          "skip: rejects an empty cart",
        ],
        count: 4,
      },
      { kind: "removed_assertions", file: path, names: [], count: 1 },
    ]);
  });

  it("AC-018-03 attack: test config changes that exclude or narrow the test files are flagged", () => {
    const before =
      'export default defineConfig({\n  test: {\n    include: ["src/**/*.test.ts"],\n  },\n});';
    const after =
      'export default defineConfig({\n  test: {\n    include: ["src/**/*.test.ts"],\n    exclude: ["src/cart/**"],\n    passWithNoTests: true,\n  },\n});';
    expect(checkTestIntegrity([{ path: "apps/web/vitest.config.ts", before, after }])).toEqual([
      {
        kind: "test_config_changed",
        file: "apps/web/vitest.config.ts",
        names: ["exclude", "passWithNoTests"],
        count: 2,
      },
    ]);
    const jest = {
      path: "jest.config.js",
      before: "module.exports = {};",
      after: 'module.exports = { testPathIgnorePatterns: ["/cart/"] };',
    };
    expect(checkTestIntegrity([jest])[0]).toMatchObject({
      kind: "test_config_changed",
      names: ["testPathIgnorePatterns"],
    });
  });

  it("AC-018-04 adding new tests, or renaming a test without removing assertions, is not flagged", () => {
    const before = suite([ADD, TOTAL]);
    expect(checkTestIntegrity([{ path, before, after: suite([ADD, TOTAL, EMPTY]) }])).toEqual([]);
    const renamed = suite([ADD.replace("adds an item", "adds one item to the cart"), TOTAL]);
    expect(checkTestIntegrity([{ path, before, after: renamed }])).toEqual([]);
    expect(
      checkTestIntegrity([{ path: "src/new.test.ts", before: null, after: suite([ADD]) }]),
    ).toEqual([]);
    // Files that are neither tests nor test config are not looked at.
    expect(
      checkTestIntegrity([{ path: "src/cart/cart.ts", before: "expect(1)", after: "" }]),
    ).toEqual([]);
  });

  it("AC-018-02 attack: realistic forms (template names, test.each, nested quotes, CRLF) are read; huge lines are skipped, not hung on", () => {
    const before = [
      "describe(`checkout ${'flow'}`, () => {",
      'test.each([[1], [2]])("pays %i", (n) => { expect(pay(n)).toBe(true); });',
      'it("handles \\"quoted\\" names", () => { expect(1).toBe(1); });',
      "});",
    ].join("\r\n");
    const after = before.replace('test.each([[1], [2]])("pays %i"', 'test.skip("pays %i"');
    expect(checkTestIntegrity([{ path: "e2e/checkout.spec.ts", before, after }])).toEqual([
      { kind: "skipped_tests", file: "e2e/checkout.spec.ts", names: ["skip: pays %i"], count: 1 },
    ]);
    const huge = `${"x".repeat(200_000)}it(\"hidden\", () => {})`;
    const started = Date.now();
    expect(checkTestIntegrity([{ path, before: huge, after: "" }])).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
