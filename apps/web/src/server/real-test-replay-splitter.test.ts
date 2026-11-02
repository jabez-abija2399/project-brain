import type { CompleteRequest, Llm } from "@brain/core";
import { describe, expect, it } from "vitest";
import { receiptSummary } from "../../../../packages/cli/src/hooks";
import {
  CHECKLIST_SYSTEM,
  NO_FILE_CHANGE_STATE,
  checklistPrompt,
  judgedByFiles,
  parseChecklist,
  splitRequest,
} from "../../../../packages/core/src/checklist";

// Real-test A (packages): one request with two checks and one change came out as one item. The request is run through
// the real splitter prompt builder and parser; only the model is a stub, answering as a correct model would.
const PACKAGES =
  'Use Codeceipt\'s check_package tool to check "zod" and "react-super-hooks-xyz" and tell me the results. Then add ' +
  '"date-fns" to the dependencies in package.json, but don\'t run npm install.';

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

const CORRECT_SPLIT = [
  '- Use Codeceipt\'s check_package tool to check "zod" and tell me the results',
  '- Use Codeceipt\'s check_package tool to check "react-super-hooks-xyz" and tell me the results',
  '- Add "date-fns" to the dependencies in package.json, and npm install is not run',
].join("\n");

describe("real-test A: a multi-part request is split into separate items", () => {
  it("the packages request keeps three items through the real splitter (stubbed correct reply)", async () => {
    const { llm, calls } = scripted(CORRECT_SPLIT);
    const items = await splitRequest(llm, PACKAGES);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toBe(checklistPrompt(PACKAGES));
    expect(items.map((i) => i.text)).toEqual([
      'Use Codeceipt\'s check_package tool to check "zod" and tell me the results',
      'Use Codeceipt\'s check_package tool to check "react-super-hooks-xyz" and tell me the results',
      'Add "date-fns" to the dependencies in package.json, and npm install is not run',
    ]);
  });

  it("the splitter prompt carries the split rules: several things joined by and/then are several items", () => {
    expect(CHECKLIST_SYSTEM).toMatch(/several things/i);
    expect(CHECKLIST_SYSTEM).toMatch(/joined by 'and', 'then'/i);
    expect(CHECKLIST_SYSTEM).toMatch(/never merge/i);
  });

  it("a one-item reply to the packages request is not kept as one item", async () => {
    const { llm } = scripted(
      '- Check "zod" and "react-super-hooks-xyz" with check_package, then add "date-fns" to package.json',
    );
    const items = await splitRequest(llm, PACKAGES);
    expect(items.map((i) => i.text)).toEqual([
      'Use Codeceipt\'s check_package tool to check "zod" and tell me the results',
      'Use Codeceipt\'s check_package tool to check "react-super-hooks-xyz" and tell me the results',
      'Add "date-fns" to the dependencies in package.json, but don\'t run npm install',
    ]);
  });

  it("a one-item reply to a request with two quoted names joined by 'and' is not kept as one item", async () => {
    const { llm } = scripted("- Check the zod and react-super-hooks-xyz packages");
    const items = await splitRequest(
      llm,
      'Check "zod" and "react-super-hooks-xyz" with check_package and tell me the results.',
    );
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(
      items.some((i) => i.text.includes('"zod"') && i.text.includes('"react-super-hooks-xyz"')),
    ).toBe(false);
  });
});

describe("real-test O: a task that changes no files is Not verified, never done, partly done or missed", () => {
  it("the state text is exactly 'Not verified (no file change expected)'", () => {
    expect(NO_FILE_CHANGE_STATE).toBe("Not verified (no file change expected)");
  });

  it("a check-and-report item is marked no_file_change; a change item is not", () => {
    expect(parseChecklist("- Check zod and tell me the result\n- Add a pricing page")).toEqual([
      {
        text: "Check zod and tell me the result",
        needs_clarification: false,
        no_file_change: true,
      },
      { text: "Add a pricing page", needs_clarification: false },
    ]);
  });

  it("the single item of a check-only request is marked no_file_change through the splitter", async () => {
    const { llm } = scripted("- Check zod and tell me the result");
    const items = await splitRequest(llm, "Check zod and tell me the result.");
    expect(items).toEqual([
      {
        text: "Check zod and tell me the result",
        needs_clarification: false,
        no_file_change: true,
      },
    ]);
  });

  it("only items judged from files are judged: questions, postponed and no-file-change items are not", () => {
    expect(judgedByFiles({ text: "Add a pricing page", needs_clarification: false })).toBe(true);
    expect(
      judgedByFiles({ text: "Check zod", needs_clarification: false, no_file_change: true }),
    ).toBe(false);
    expect(
      judgedByFiles({ text: "Add a footer", needs_clarification: false, postponed: true }),
    ).toBe(false);
    expect(judgedByFiles({ text: "Which currency?", needs_clarification: true })).toBe(false);
  });
});

// Receipt summary (P): the line counts each item in exactly one state and lists only the non-zero states.
const CONFIG = { apiUrl: "https://codeceipts.test", projectId: "p1" } as unknown as Parameters<
  typeof receiptSummary
>[1];
const summaryLine = (receipt: Record<string, unknown>, files?: number) =>
  receiptSummary(receipt, CONFIG, null, files)[0];

describe("real-test P: the receipt summary line counts each item once", () => {
  it("one partly done item is 'partly done', not 'missed (1 partly done)'", () => {
    expect(summaryLine({ items: [{ status: "partial" }] }, 1)).toBe(
      "Codeceipt receipt: 1 file changed; 1 partly done.",
    );
  });

  it("one done item lists only 'done'", () => {
    expect(summaryLine({ items: [{ status: "done" }] }, 1)).toBe(
      "Codeceipt receipt: 1 file changed; 1 done.",
    );
  });

  it("zero states are not listed, and each state counts only its own items", () => {
    expect(
      summaryLine(
        {
          items: [
            { status: "done" },
            { status: "done_untested" },
            { status: "partial" },
            { status: "missed" },
            { status: "not_verified" },
          ],
        },
        2,
      ),
    ).toBe("Codeceipt receipt: 2 files changed; 2 done, 1 partly done, 1 missed, 1 not verified.");
  });

  it("a not verified item is not counted as done or missed", () => {
    expect(summaryLine({ items: [{ status: "not_verified" }] }, 1)).toBe(
      "Codeceipt receipt: 1 file changed; 1 not verified.",
    );
  });

  it("a receipt with no counted item says so instead of an empty state list", () => {
    expect(summaryLine({ items: [{ status: "postponed" }] })).toBe("Codeceipt receipt: no items.");
  });
});
