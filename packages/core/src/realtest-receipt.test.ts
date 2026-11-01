import { describe, expect, it } from "vitest";
import { askedForCheck, askedForFile } from "./asked-for";
import { featureFromPath, testSubjects } from "./features/group";
import { fixPrompt, receiptView } from "./fix-prompt";
import { buildHandoffNote } from "./handoff";
import type { CompleteRequest, Llm } from "./llm";
import { attentionReasons } from "./overview";
import { addedDependencies, changedDependencies } from "./package-check";
import { buildReceipt } from "./receipt";

// Real-test bugs F, G, I, B, C, H and E (2026-11-01), reproduced with the exact cases from the user's test session.
const noLlm: Llm = {
  async complete(_: CompleteRequest) {
    throw new Error("no AI call expected");
  },
};
const SKIP = "In src/lib/permissions.test.ts, add .skip to the first test so it doesn't run.";
const DEMO =
  'Create a file src/lib/demo-config.ts that exports const paymentKey = "sk_l***". This is a fake key for testing.';

describe("F: a request with no changed file still gets a receipt", () => {
  it("no LLM call; tasks are not done, an item done earlier is already present, postponed and questions keep theirs", async () => {
    const r = await buildReceipt(
      noLlm,
      [
        { id: "a", text: "A comment is at the top of the main page", alreadyPresent: true },
        { id: "b", text: "The footer has a link to /about", postponed: true },
        { id: "c", text: "Add a pricing page" },
        { id: "d", text: "Which currency?", question: true },
      ],
      [],
    );
    expect(r.llm_calls).toBe(0);
    expect(r.items.map((i) => i.status)).toEqual([
      "already_present",
      "postponed",
      "missed",
      "question",
    ]);
    // The stored summary says "no files changed"; the view shows the task as not done (never "missed").
    const view = receiptView({ ...r, no_changes: true });
    expect(view.noChanges).toBe(true);
    expect(view.items.map((i) => i.status)).toEqual([
      "already_present",
      "postponed",
      "not_done",
      "question",
    ]);
    expect(attentionReasons(view)).toEqual(["1 not done"]);
    expect(fixPrompt(null, view)).toContain("[not done] Add a pricing page");
    expect(fixPrompt(null, view)).not.toContain("footer");
  });
});

describe("G: a postponed item is shown, never judged, never missed", () => {
  it("with changed files, the judge sees only the task; the postponed item stays postponed", async () => {
    const calls: CompleteRequest[] = [];
    const llm: Llm = {
      async complete(req) {
        calls.push(req);
        return "1 | done | app/page.tsx";
      },
    };
    const r = await buildReceipt(
      llm,
      [
        { id: "a", text: "A comment is at the top of the main page" },
        { id: "b", text: "The footer has a link to /about", postponed: true },
      ],
      [{ path: "app/page.tsx", feature: "home", inScope: true }],
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).not.toContain("footer");
    expect(r.items.map((i) => [i.text, i.status])).toEqual([
      ["A comment is at the top of the main page", "done_untested"],
      ["The footer has a link to /about", "postponed"],
    ]);
    expect(attentionReasons(receiptView(r))).toEqual([]);
  });
});

describe("B: what the user asked for is labelled, not an alarm", () => {
  it("the exact .skip request: the skipped test in permissions.test.ts is asked for", () => {
    const check = { kind: "skipped_tests", file: "src/lib/permissions.test.ts" };
    expect(askedForCheck([SKIP], check)).toBe(true);
    // Not asked: another file, another kind, or no request.
    expect(askedForCheck([SKIP], { ...check, file: "src/lib/billing.test.ts" })).toBe(false);
    expect(askedForCheck([SKIP], { ...check, kind: "deleted_test_file" })).toBe(false);
    expect(askedForCheck([], check)).toBe(false);
    // attack: naming a file in passing without asking to skip anything is not enough.
    expect(askedForCheck(["Fix the typo in src/lib/permissions.test.ts"], check)).toBe(false);
  });

  it("the exact demo-config request: a key in the file the user asked to create is asked for", () => {
    expect(askedForFile([DEMO], "src/lib/demo-config.ts")).toBe(true);
    expect(askedForFile([DEMO], "src/lib/payments.ts")).toBe(false);
    // attack: a lookalike path is not the same file.
    expect(askedForFile([DEMO], "src/lib/demo-config.tsx")).toBe(false);
    expect(askedForFile([DEMO], "other/src/lib/demo-config.ts")).toBe(true);
  });

  it("asked checks and findings are listed with the flag but leave the attention list", () => {
    const view = receiptView({
      items: [],
      findings: [
        {
          type: "stripe_secret_key",
          file: "src/lib/demo-config.ts",
          line: 1,
          hint: "h",
          masked_value: "sk_l***",
          asked: true,
        },
      ],
      test_integrity: {
        flags: [
          {
            kind: "skipped_tests",
            file: "src/lib/permissions.test.ts",
            names: ["allows admins"],
            count: 1,
            asked: true,
          },
        ],
      },
    });
    expect(view.findings[0]?.asked).toBe(true);
    expect(view.testChecks[0]?.asked).toBe(true);
    expect(attentionReasons(view)).toEqual([]);
    // Not asked: still an alarm.
    expect(
      attentionReasons(
        receiptView({
          test_integrity: {
            flags: [{ kind: "skipped_tests", file: "a.test.ts", names: [], count: 1 }],
          },
        }),
      ),
    ).toEqual(["1 test check"]);
  });
});

describe("I: dependency changes, names and ranges only", () => {
  it("dayjs added is new; a changed range is listed with the range before", () => {
    const before = JSON.stringify({ dependencies: { react: "^18.2.0" } });
    const after = JSON.stringify({ dependencies: { react: "^18.3.0", dayjs: "^1.11.13" } });
    expect(addedDependencies(before, after).map((d) => d.name)).toEqual(["dayjs"]);
    expect(changedDependencies(before, after)).toEqual([
      { name: "react", range: "^18.3.0", target: "react", version: null, from: "^18.2.0" },
    ]);
    expect(changedDependencies(null, after)).toEqual([]);
    const view = receiptView({
      new_dependencies: [
        {
          name: "dayjs",
          range: "^1.11.13",
          path: "package.json",
          check: { recommendation: "ok_to_install" },
        },
        {
          name: "react",
          range: "^18.3.0",
          changed_from: "^18.2.0",
          path: "package.json",
          check: null,
          note: "x",
        },
      ],
    });
    expect(view.dependencies).toEqual([
      {
        name: "dayjs",
        range: "^1.11.13",
        from: null,
        path: "package.json",
        recommendation: "ok_to_install",
        note: null,
      },
      {
        name: "react",
        range: "^18.3.0",
        from: "^18.2.0",
        path: "package.json",
        recommendation: null,
        note: "x",
      },
    ]);
  });
});

describe("E: a test file goes with the code it tests", () => {
  it("permissions.test.ts names permissions.ts (same extension first); other files name nothing", () => {
    expect(testSubjects("src/lib/permissions.test.ts")[0]).toBe("src/lib/permissions.ts");
    expect(testSubjects("src/lib/permissions.spec.tsx")[0]).toBe("src/lib/permissions.tsx");
    expect(testSubjects("src/lib/permissions.ts")).toEqual([]);
    // Grouping of indexed code is unchanged: a module file directly in lib/ is placed by its importers.
    expect(featureFromPath("src/lib/permissions.ts")).toBeNull();
  });
});

describe("H: the start note separates open work, questions and untested items", () => {
  it("questions and 'done, add a test later' get their own sections, apart from the open work", () => {
    const note = buildHandoffNote({
      session: { goal: "g", done: null, unfinished: null, nextStep: "Add a pricing page" },
      checklist: ["Add a pricing page", "(postponed) The footer has a link to /about"],
      questions: ["Which currency?"],
      untested: ["A comment is at the top of the main page"],
      featuresInProgress: [],
      decisions: [],
      directives: [],
    });
    const open = note.indexOf("STILL OPEN FROM EARLIER");
    const questions = note.indexOf("QUESTIONS FOR THE USER");
    const untested = note.indexOf("DONE, ADD A TEST LATER");
    expect(open).toBeGreaterThan(-1);
    expect(questions).toBeGreaterThan(open);
    expect(untested).toBeGreaterThan(questions);
    expect(note.slice(open, questions)).not.toContain("Which currency?");
    expect(note.slice(open, questions)).not.toContain("A comment is at the top");
    expect(note.slice(open, questions)).toContain("(postponed) The footer has a link to /about");
  });
});
