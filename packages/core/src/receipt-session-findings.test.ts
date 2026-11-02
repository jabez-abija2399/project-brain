// K: the session's own findings (test checks, secrets, new dependencies) are given to the judge as masked facts, and
// the rule is explicit: an item fulfilled by exactly that change is done. Fake secrets are built at runtime.
import { describe, expect, it } from "vitest";
import type { CompleteRequest, Llm } from "./llm";
import { MAX_PROMPT_CHARS, buildReceipt, planPrompt } from "./receipt";

const PERMISSIONS = "src/lib/permissions.test.ts";
const FAKE_KEY = ["sk_live_", "Zr8Qw2Lm5", "Xp9Tn4Vb7", "Kc1Hd6"].join("");
const SKIP_FINDING = `tests skipped or focused (1) in ${PERMISSIONS}: skip: denies guests`;
const items = [{ id: "i1", text: "Add .skip to the second test in src/lib/permissions.test.ts" }];
const files = [
  {
    path: PERMISSIONS,
    feature: "permissions",
    inScope: true,
    summary: {
      path: PERMISSIONS,
      added: 1,
      removed: 1,
      comment_only: false,
      imports_changed: false,
      symbols_added: [],
      symbols_removed: [],
      symbols_changed: [],
      where: ["line 6"],
    },
  },
];

function scripted(answer: string) {
  const calls: CompleteRequest[] = [];
  const llm: Llm = {
    async complete(req) {
      calls.push(req);
      return answer;
    },
  };
  return { llm, calls };
}

describe("K: session findings reach the judge", () => {
  it("the skip finding is a labelled SESSION FINDINGS section of the prompt", () => {
    const plan = planPrompt(items, files, [SKIP_FINDING]);
    expect(plan.prompt).toContain("SESSION FINDINGS");
    expect(plan.prompt).toContain(SKIP_FINDING);
  });

  it("with the finding, a done verdict for the item is kept as done (not not_verified)", async () => {
    const { llm, calls } = scripted(`1 | done | ${PERMISSIONS}`);
    const receipt = await buildReceipt(llm, items, files, [SKIP_FINDING]);
    expect(calls[0]?.prompt).toContain(SKIP_FINDING);
    expect(receipt.items).toEqual([
      { id: "i1", text: items[0]?.text, status: "done", evidence: [PERMISSIONS] },
    ]);
    expect(receipt.not_verified).toEqual([]);
  });

  it("without the finding the same item stays not verified: the judge cannot tell from the summary", async () => {
    const { llm, calls } = scripted(`1 | unclear | ${PERMISSIONS}`);
    const receipt = await buildReceipt(llm, items, files);
    expect(calls[0]?.prompt).not.toContain("SESSION FINDINGS");
    expect(receipt.items[0]?.status).toBe("not_verified");
  });

  it("attack: a secret inside a finding is masked (first 4 characters + ***) before the judge sees it", async () => {
    const { llm, calls } = scripted(`1 | done | ${PERMISSIONS}`);
    await buildReceipt(llm, items, files, [`skip: ${FAKE_KEY} in ${PERMISSIONS}`]);
    const prompt = calls[0]?.prompt ?? "";
    expect(prompt).toContain("SESSION FINDINGS");
    expect(prompt).not.toContain("Zr8Qw2Lm5");
    expect(prompt).not.toContain(FAKE_KEY);
  });

  it("attack: findings are capped: the rest are said to be left out, and the prompt stays under the cap", () => {
    const many = Array.from(
      { length: 60 },
      (_, n) => `dependency check ${n} ${"x".repeat(150)} in package.json`,
    );
    const plan = planPrompt(items, files, many);
    expect(plan.prompt.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    expect(plan.prompt).toContain("left out of the AI check");
  });
});
