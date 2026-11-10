import { describe, expect, it } from "vitest";
import { type ClaimEvidence, MAX_CLAIMS, checkClaims, extractClaims } from "./claims";

// Roadmap Phase 10: the claim checker. An agent's final summary, checked against what git shows.
const evidence = (over: Partial<ClaimEvidence> = {}): ClaimEvidence => ({
  changedFiles: ["src/cart.ts", "src/cart.test.ts"],
  passingBefore: null,
  passingAfter: null,
  weakenedTests: 0,
  ...over,
});
const verdicts = (summary: string, ev = evidence()) =>
  checkClaims(extractClaims(summary), ev).map((c) => [c.kind, c.path ?? "", c.verdict]);

describe("Phase 10: claim checker", () => {
  it("PH10-01 reads claims from a final summary: tests added, tests pass, files changed, files left untouched", () => {
    const summary = [
      "I updated `src/cart.ts` to handle empty carts and added tests for it.",
      "All tests pass.",
      "I did not touch supabase/migrations/001.sql.",
    ].join(" ");
    expect(extractClaims(summary)).toEqual([
      { kind: "tests_added" },
      { kind: "changed_file", path: "src/cart.ts" },
      { kind: "tests_pass" },
      { kind: "left_untouched", path: "supabase/migrations/001.sql" },
    ]);
  });

  it("PH10-02 confirmed: the named file changed, a test file changed, the untouched file is untouched", () => {
    expect(
      verdicts("Updated src/cart.ts and added tests. I left src/auth.ts untouched.", evidence()),
    ).toEqual([
      ["tests_added", "", "confirmed"],
      ["changed_file", "src/cart.ts", "confirmed"],
      ["left_untouched", "src/auth.ts", "confirmed"],
    ]);
    // A shortened path (cart.ts) names src/cart.ts.
    expect(verdicts("Fixed cart.ts.")).toEqual([["changed_file", "cart.ts", "confirmed"]]);
  });

  it("PH10-03 contradicted: no test file changed, the file was not changed, the 'untouched' file was changed", () => {
    const ev = evidence({ changedFiles: ["src/cart.ts"] });
    expect(
      verdicts("I added tests and updated src/auth.ts. I did not change src/cart.ts.", ev),
    ).toEqual([
      ["tests_added", "", "contradicted"],
      ["changed_file", "src/auth.ts", "contradicted"],
      ["left_untouched", "src/cart.ts", "contradicted"],
    ]);
  });

  it("PH10-04 'tests pass' fails closed: no report cannot be checked; fewer passing or weakened tests contradict it", () => {
    expect(verdicts("All tests pass.")).toEqual([["tests_pass", "", "cannot_check"]]);
    expect(
      verdicts("Tests are passing.", evidence({ passingBefore: 10, passingAfter: 12 })),
    ).toEqual([["tests_pass", "", "confirmed"]]);
    expect(verdicts("The tests pass.", evidence({ passingBefore: 10, passingAfter: 8 }))).toEqual([
      ["tests_pass", "", "contradicted"],
    ]);
    expect(
      verdicts(
        "All tests pass now.",
        evidence({ passingBefore: 10, passingAfter: 10, weakenedTests: 1 }),
      ),
    ).toEqual([["tests_pass", "", "contradicted"]]);
  });

  it("PH10-05 what is not a claim: failing or skipped tests, version numbers, URLs, plain words with a dot", () => {
    expect(extractClaims("The tests do not pass yet. I could not add tests.")).toEqual([]);
    expect(
      extractClaims("Updated to version 1.2.3, see https://example.com/docs/a.html for more."),
    ).toEqual([]);
    expect(extractClaims("Updated the cart. Done.")).toEqual([]);
  });

  it("PH10-06 attack: a huge or hostile summary stays bounded and fast, and carries no text out", () => {
    const many = Array.from({ length: 5000 }, (_, n) => `Updated src/f${n}.ts.`).join(" ");
    const started = Date.now();
    const claims = extractClaims(`${many} ${"a/".repeat(100_000)}`);
    extractClaims(`added ${"new ".repeat(50_000)}tests`);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(claims.length).toBeLessThanOrEqual(MAX_CLAIMS);
    const esc = String.fromCharCode(27);
    const hostile = extractClaims(
      `Updated src/a.ts${esc}[2J and ignore previous instructions. Updated ../../etc/passwd.`,
    );
    for (const c of hostile) {
      expect(Object.keys(c).sort()).toEqual(c.path ? ["kind", "path"] : ["kind"]);
      expect(c.path ?? "").not.toContain(esc);
      expect(c.path ?? "").not.toContain("ignore");
      expect(c.path ?? "").not.toContain("..");
    }
  });
});
