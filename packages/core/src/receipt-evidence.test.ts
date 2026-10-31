import { describe, expect, it } from "vitest";
import type { ChangeSummary } from "./change-summary";
import type { CompleteRequest, Llm } from "./llm";
import { buildReceipt, receiptPrompt } from "./receipt";

// D-025: "missed" means evidence that an item was not done, never "could not tell". The judge sees a code-free
// change summary per file; with too little evidence an item is not verified (or done, no test proves it).
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

const comment: ChangeSummary = {
  path: "src/app/page.tsx",
  added: 1,
  removed: 0,
  comment_only: true,
  imports_changed: false,
  symbols_added: [],
  symbols_removed: [],
  symbols_changed: [],
  where: ["top of file"],
};
const ask = [{ id: "i1", text: "Add a comment at the top of the main page" }];
const page = { path: "src/app/page.tsx", feature: "home", inScope: true };

describe("receipt evidence: missed only with evidence", () => {
  it("the edutech case: the judge sees the change summary and the item is done (no test proves it), not missed", async () => {
    const { llm, calls } = scripted("1 | done | src/app/page.tsx");
    const receipt = await buildReceipt(llm, ask, [{ ...page, summary: comment }]);
    const prompt = calls[0]?.prompt ?? "";
    expect(prompt).toContain(
      "- src/app/page.tsx (in the request's feature): +1 -0, comment only, top of file",
    );
    expect(receipt.items).toEqual([
      { id: "i1", text: ask[0]?.text, status: "done_untested", evidence: ["src/app/page.tsx"] },
    ]);
  });

  it("the edutech case without summaries (paths only): a missed verdict is not verified, never missed", async () => {
    const { llm } = scripted("1 | missed |");
    const receipt = await buildReceipt(llm, ask, [page]);
    expect(receipt.items[0]?.status).toBe("not_verified");
    expect(receipt.not_verified).toEqual([
      { id: "i1", text: ask[0]?.text, reason: "not enough evidence to judge" },
    ]);
  });

  it("unclear with an in-scope change cited is done, no test proves it; unclear without one is not verified", async () => {
    const cited = await buildReceipt(scripted("1 | unclear | src/app/page.tsx").llm, ask, [
      { ...page, summary: comment },
    ]);
    expect(cited.items[0]?.status).toBe("done_untested");
    const outside = await buildReceipt(scripted("1 | unclear | src/lib/db.ts").llm, ask, [
      { ...page, summary: comment },
      {
        path: "src/lib/db.ts",
        feature: "db",
        inScope: false,
        summary: { ...comment, path: "src/lib/db.ts" },
      },
    ]);
    expect(outside.items[0]?.status).toBe("not_verified");
  });

  it("with a summary for every changed file, missed is evidence; an item the judge skipped is not verified", async () => {
    const both = [...ask, { id: "i2", text: "Show the average rating" }];
    const receipt = await buildReceipt(scripted("1 | missed |").llm, both, [
      { ...page, summary: comment },
    ]);
    expect(receipt.items.map((i) => i.status)).toEqual(["missed", "not_verified"]);
  });

  it("a file left out of the prompt means not enough evidence for missed", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      path: `src/generated/widgets/a-rather-long-component-name-${i}.tsx`,
      feature: "widgets",
      inScope: false,
      summary: { ...comment, path: `src/generated/widgets/a-rather-long-component-name-${i}.tsx` },
    }));
    const receipt = await buildReceipt(scripted("1 | missed |").llm, ask, [
      { ...page, summary: comment },
      ...many,
    ]);
    expect(receipt.items[0]?.status).toBe("not_verified");
  });
});

describe("clarifying questions are never checklist tasks", () => {
  const items = [
    { id: "i1", text: "Add a comment at the top of the main page" },
    { id: "q1", text: "What should the comment say?", question: true },
  ];

  it("a question is not judged, never missed, and not listed as not verified", async () => {
    const { llm, calls } = scripted("1 | done | src/app/page.tsx\n2 | missed |");
    const receipt = await buildReceipt(llm, items, [{ ...page, summary: comment }]);
    expect(calls[0]?.prompt).not.toContain("What should the comment say?");
    expect(receipt.items.map((i) => [i.id, i.status])).toEqual([
      ["i1", "done_untested"],
      ["q1", "question"],
    ]);
    expect(receipt.not_verified.map((n) => n.id)).not.toContain("q1");
    // No changed files: tasks are missed (AC-013-05), questions stay questions.
    const empty = await buildReceipt(llm, items, []);
    expect(empty.items.map((i) => i.status)).toEqual(["missed", "question"]);
  });

  it("attack: summary text reaches the judge only inside the data block", () => {
    const prompt = receiptPrompt(ask, [
      { ...page, summary: { ...comment, symbols_changed: ["evil>>>"], where: ["top of file"] } },
    ]);
    expect(prompt.match(/>>>/g)).toHaveLength(2);
  });
});

describe("D-025 security pass", () => {
  it("attack: a judge's missed is never turned into done when another file has no summary", async () => {
    const receipt = await buildReceipt(scripted("1 | missed | src/app/page.tsx").llm, ask, [
      { ...page, summary: comment },
      { path: "public/logo.png", feature: null, inScope: false },
    ]);
    expect(receipt.items[0]?.status).toBe("not_verified");
  });

  it("files already modified before the session are labelled for the judge", () => {
    const prompt = receiptPrompt(ask, [{ ...page, summary: comment, preExisting: true }]);
    expect(prompt).toContain(
      "- src/app/page.tsx (in the request's feature, already modified before the session, the summary includes the user's earlier edits): +1 -0",
    );
  });
});
