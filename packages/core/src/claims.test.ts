import { describe, expect, it } from "vitest";
import { type ClaimEvidence, MAX_CLAIMS, checkClaims, extractClaims } from "./claims";

// Roadmap Phase 10: the claim checker. An agent's final summary, checked against what git shows. Fake secrets are
// built at run time.
const REPO = [
  "src/cart.ts",
  "src/cart.test.ts",
  "src/auth.ts",
  "app/a/page.tsx",
  "app/b/page.tsx",
  "supabase/migrations/001.sql",
];
const evidence = (over: Partial<ClaimEvidence> = {}): ClaimEvidence => ({
  changedFiles: ["src/cart.ts", "src/cart.test.ts"],
  knownFiles: REPO,
  testFilesChanged: 1,
  passingBefore: null,
  passingAfter: null,
  failedAfter: null,
  reportFresh: false,
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

  it("PH10-02 confirmed: the named file changed, a test file changed, the untouched file or folder is untouched", () => {
    expect(verdicts("Updated src/cart.ts and added tests. I left src/auth.ts untouched.")).toEqual([
      ["tests_added", "", "confirmed"],
      ["changed_file", "src/cart.ts", "confirmed"],
      ["left_untouched", "src/auth.ts", "confirmed"],
    ]);
    // A shortened path that names exactly one file of the repo is shown as that file's real path.
    expect(verdicts("Fixed cart.ts.")).toEqual([["changed_file", "src/cart.ts", "confirmed"]]);
    expect(verdicts("No changes to supabase/migrations.")).toEqual([
      ["left_untouched", "supabase/migrations", "confirmed"],
    ]);
  });

  it("PH10-03 contradicted: no test file changed, the file was not changed, the 'untouched' file was changed", () => {
    const ev = evidence({ changedFiles: ["src/cart.ts"], testFilesChanged: 0 });
    expect(
      verdicts("I added tests and updated src/auth.ts. I did not change src/cart.ts.", ev),
    ).toEqual([
      ["tests_added", "", "contradicted"],
      ["changed_file", "src/auth.ts", "contradicted"],
      ["left_untouched", "src/cart.ts", "contradicted"],
    ]);
  });

  it("PH10-04 'tests pass' fails closed: only a report from this session with no failures confirms it", () => {
    expect(verdicts("All tests pass.")).toEqual([["tests_pass", "", "cannot_check"]]);
    const fresh = { passingBefore: 10, passingAfter: 12, failedAfter: 0, reportFresh: true };
    expect(verdicts("Tests are passing.", evidence(fresh))).toEqual([
      ["tests_pass", "", "confirmed"],
    ]);
    // Security review: an old report, or one with failures, never confirms.
    expect(verdicts("Tests pass.", evidence({ ...fresh, reportFresh: false }))).toEqual([
      ["tests_pass", "", "cannot_check"],
    ]);
    expect(verdicts("Tests pass.", evidence({ ...fresh, failedAfter: 30 }))).toEqual([
      ["tests_pass", "", "contradicted"],
    ]);
    expect(verdicts("Tests pass.", evidence({ ...fresh, failedAfter: null }))).toEqual([
      ["tests_pass", "", "cannot_check"],
    ]);
    expect(verdicts("The tests pass.", evidence({ ...fresh, passingAfter: 8 }))).toEqual([
      ["tests_pass", "", "contradicted"],
    ]);
    expect(verdicts("All tests pass now.", evidence({ ...fresh, weakenedTests: 1 }))).toEqual([
      ["tests_pass", "", "contradicted"],
    ]);
  });

  it("PH10-05 what is not a claim: failing or skipped tests, vague words, and sentences that mix changed and untouched files", () => {
    expect(extractClaims("The tests do not pass yet. I could not add tests.")).toEqual([]);
    expect(extractClaims("Updated the cart. Done.")).toEqual([]);
    // Which file was left alone cannot be told, so neither is claimed.
    expect(extractClaims("Fixed src/cart.ts without changing src/auth.ts.")).toEqual([]);
    // "left a TODO" is not "left untouched".
    expect(extractClaims("I left a TODO in src/cart.ts and updated the handler.")).toEqual([
      { kind: "changed_file", path: "src/cart.ts" },
    ]);
  });

  it("PH10-06 attack (security review): only real paths of this repo are kept; keys, emails, dates and URLs are dropped", () => {
    const key = ["wJalrXUtnFEMI", "K7MDENG", "bPxRfiCYEXAMPLEKEY"].join("/");
    const summary = [
      `Added the key ${key}.`,
      "Added example.com/hook/tok_live_9f8a7b6c.",
      "Fixed login for alice@startup.sh and bob@corp.rs.",
      "Updated client/server on 10/11/2026 for John/Jane.",
      "Updated ../../etc/passwd.",
      "Updated src/cart.ts.",
    ].join(" ");
    const checked = checkClaims(extractClaims(summary), evidence());
    expect(checked).toEqual([{ kind: "changed_file", path: "src/cart.ts", verdict: "confirmed" }]);
    // A bare file name shared by several files names none of them.
    expect(verdicts("I did not touch page.tsx.")).toEqual([]);
  });

  it("PH10-07 attack: unknown changes cannot be checked; a huge summary stays bounded and fast", () => {
    const unknown = evidence({ changedFiles: null, testFilesChanged: null });
    expect(
      verdicts("Updated src/cart.ts, added tests. No changes to src/auth.ts.", unknown),
    ).toEqual([
      ["tests_added", "", "cannot_check"],
      ["changed_file", "src/cart.ts", "cannot_check"],
      ["left_untouched", "src/auth.ts", "cannot_check"],
    ]);
    const many = Array.from({ length: 5000 }, (_, n) => `Updated src/f${n}.ts.`).join(" ");
    const started = Date.now();
    const claims = extractClaims(`${many} ${"a/".repeat(100_000)}`);
    extractClaims(`added ${"new ".repeat(50_000)}tests`);
    extractClaims(`left ${"x ".repeat(50_000)}alone`);
    checkClaims(
      claims,
      evidence({ knownFiles: Array.from({ length: 50_000 }, (_, n) => `src/g${n}.ts`) }),
    );
    expect(Date.now() - started).toBeLessThan(1500);
    expect(claims.length).toBeLessThanOrEqual(MAX_CLAIMS);
  });
});
