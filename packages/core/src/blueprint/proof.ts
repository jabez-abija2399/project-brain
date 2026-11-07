// Phase 3a: how sure we are that a criterion holds. Honest evidence: never more certainty than the tests give.
// A test file that is gone proves nothing; a linked test that never ran proves nothing either.

export type Proof = "proven" | "done_not_proven" | "not_proven" | "contradicted";

const DONE = new Set(["done", "done_untested"]);

export function proofStatus(input: {
  tests: { present: boolean; lastResult?: "pass" | "fail" | null }[];
  itemStatus?: string | null;
  contradicted?: boolean;
}): Proof {
  const present = input.tests.filter((t) => t.present);
  if (input.contradicted || present.some((t) => t.lastResult === "fail")) return "contradicted";
  if (present.some((t) => t.lastResult === "pass")) return "proven";
  if (input.itemStatus && DONE.has(input.itemStatus)) return "done_not_proven";
  return "not_proven";
}
