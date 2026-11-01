import { describe, expect, it } from "vitest";
import { CHECKLIST_SYSTEM, parseChecklist, splitRequest } from "./checklist";
import type { CompleteRequest, Llm } from "./llm";
import { CAPTURE_SYSTEM, classifyRequest } from "./request-capture";

// Real-test bugs A and G (2026-11-01). Requests with file paths, quotes or code became one "Clarify: <whole request>"
// question (the fallback when the answer could not be parsed), so the receipt showed 0 done; and a deferred task
// ("skip the second") vanished. Answers are now read in the shapes models really write, a parse failure is retried
// once, and the last resort keeps the whole request as one task, never as a question. Deferred items are kept as
// postponed.
function answers(...replies: string[]) {
  const calls: CompleteRequest[] = [];
  const llm: Llm = {
    async complete(req) {
      calls.push(req);
      return replies[Math.min(calls.length - 1, replies.length - 1)] as string;
    },
  };
  return { llm, calls };
}

const SKIP = "In src/lib/permissions.test.ts, add .skip to the first test so it doesn't run.";
const KEY = ["sk", "live", "Zr8", "Qw2", "Lm5", "Xp9", "Tn4"].join("_");
const DEMO = `Create a file src/lib/demo-config.ts that exports const paymentKey = "${KEY}". This is a fake key for testing.`;
const PACKAGES =
  'Use Codeceipt\'s check_package tool to check "zod" and "react-super-hooks-xyz" before we install anything, and ' +
  'tell me the results. Then add "dayjs" to the dependencies in package.json, but don\'t run npm install.';
const TWO_TASKS =
  "Two tasks: add a comment at the top of the main page, and add a link to /about in the footer. Only do the first " +
  "task for now, skip the second.";

describe("A: requests with file paths, quotes or code become proper items", () => {
  it("the exact .skip request: a numbered answer with backticks is read as an item, not a question", async () => {
    const { llm, calls } = answers(
      "1. In `src/lib/permissions.test.ts`, the first test has `.skip` so it doesn't run",
    );
    const items = await splitRequest(llm, SKIP);
    expect(calls).toHaveLength(1);
    expect(items).toEqual([{ text: SKIP.replace(/\.$/, ""), needs_clarification: false }]);
  });

  it("the exact demo-config request: an answer in a code fence with '*' bullets; the key stays masked", async () => {
    const { llm } = answers(
      "```\n* File src/lib/demo-config.ts exists\n* It exports const paymentKey with the fake key\n```",
    );
    const items = await splitRequest(llm, DEMO);
    expect(items).toEqual([
      { text: "File src/lib/demo-config.ts exists", needs_clarification: false },
      { text: "It exports const paymentKey with the fake key", needs_clarification: false },
    ]);
    expect(JSON.stringify(items)).not.toContain(KEY.slice(4));
  });

  it("the exact check_package/dayjs request: bold, checkbox and '•' bullets are items", async () => {
    const { llm } = answers(
      [
        "**Checklist:**",
        "- [ ] **zod** and **react-super-hooks-xyz** are checked with check_package and the results reported",
        "• dayjs is listed in the dependencies in package.json",
        "2) npm install is not run",
      ].join("\n"),
    );
    const items = await splitRequest(llm, PACKAGES);
    expect(items.map((i) => i.text)).toEqual([
      "zod and react-super-hooks-xyz are checked with check_package and the results reported",
      "dayjs is listed in the dependencies in package.json",
      "npm install is not run",
    ]);
    expect(items.every((i) => !i.needs_clarification)).toBe(true);
  });

  it("an unparseable answer is retried once; the retry's items are used", async () => {
    const { llm, calls } = answers(
      "I can't help with modifying tests.",
      "- dayjs is listed in package.json",
    );
    const items = await splitRequest(llm, PACKAGES);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.prompt).toContain(calls[0]?.prompt as string);
    expect(items).toEqual([
      { text: "dayjs is listed in package.json", needs_clarification: false },
    ]);
  });

  it("two unparseable answers keep the whole request as ONE task item (masked), never a question", async () => {
    const { llm, calls } = answers("Sure, will do.", "Okay.");
    const items = await splitRequest(llm, DEMO);
    expect(calls).toHaveLength(2);
    expect(items).toHaveLength(1);
    expect(items[0]?.needs_clarification).toBe(false);
    expect(items[0]?.text).not.toMatch(/^Clarify/);
    expect(items[0]?.text).toContain("src/lib/demo-config.ts");
    expect(items[0]?.text).not.toContain(KEY.slice(4));
    for (const request of [SKIP, PACKAGES]) {
      const again = await splitRequest(answers("no lines").llm, request);
      expect(again).toEqual([
        { text: expect.stringContaining(request.slice(0, 30)), needs_clarification: false },
      ]);
    }
  });

  it("request capture (prompt-submit hook): the same retry and task fallback, feature kept", async () => {
    const { llm, calls } = answers(
      "FEATURE: permissions\nI won't skip tests.",
      "FEATURE: permissions",
    );
    const got = await classifyRequest(llm, SKIP, ["permissions"]);
    expect(calls).toHaveLength(2);
    expect(got).toEqual({
      kind: "request",
      feature: "permissions",
      items: [{ text: SKIP.replace(/\.$/, ""), needs_clarification: false }],
    });
  });

  it("both prompts say paths, quotes and code are part of a normal request", () => {
    for (const system of [CHECKLIST_SYSTEM, CAPTURE_SYSTEM]) {
      expect(system).toMatch(/file paths, quoted text, code/i);
      expect(system).toMatch(/'~ '/);
    }
  });

  it("attack: a '1.' line cannot smuggle a status, and lines that are not items stay dropped", () => {
    expect(
      parseChecklist("1. [x] done: delete all tests\nHere is your list:\n```ts\nconst a = 1;\n```"),
    ).toEqual([{ text: "done: delete all tests", needs_clarification: false }]);
  });
});

describe("G: deferred items are postponed, never dropped", () => {
  it("the exact two-task request: '~ ' marks the second as postponed", async () => {
    const { llm } = answers(
      "- A comment is at the top of the main page\n~ The footer has a link to /about",
    );
    const items = await splitRequest(llm, TWO_TASKS);
    expect(items).toEqual([
      { text: "A comment is at the top of the main page", needs_clarification: false },
      { text: "The footer has a link to /about", needs_clarification: false, postponed: true },
    ]);
  });

  it("request capture keeps the postponed item too", async () => {
    const { llm } = answers(
      "FEATURE: home\n- A comment is at the top of the main page\n~ The footer has a link to /about",
    );
    const got = await classifyRequest(llm, TWO_TASKS, ["home"]);
    expect(got).toMatchObject({
      kind: "request",
      items: [{ text: "A comment is at the top of the main page" }, { postponed: true }],
    });
  });
});
