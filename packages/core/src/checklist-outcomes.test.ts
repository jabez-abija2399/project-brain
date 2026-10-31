import { describe, expect, it } from "vitest";
import { CHECKLIST_SYSTEM, checklistPrompt, parseChecklist, splitRequest } from "./checklist";
import type { CompleteRequest, Llm } from "./llm";
import { CAPTURE_SYSTEM, classifyRequest } from "./request-capture";

// Edutech after PR #22: "Add a comment at the top of the main page explaining what it shows." became 4 items with
// steps like "Find the main page file". Items are outcomes the user would check, never steps or implementation rules,
// and a short single-purpose request is exactly 1 item.
const ASK = "Add a comment at the top of the main page explaining what it shows.";
// What the model answered in the real test (steps and a rule around the one outcome).
const OVER_SPLIT = [
  "- Find the main page file",
  "- Add a comment at the top of the main page",
  "- Explain in the comment what the page shows",
  "- Keep the existing code unchanged",
].join("\n");
const scripted = (answer: string) => {
  const calls: CompleteRequest[] = [];
  const llm: Llm = {
    async complete(req) {
      calls.push(req);
      return answer;
    },
  };
  return { llm, calls };
};

describe("checklist items are outcomes, not steps", () => {
  it("the edutech request through the real splitter prompt and parser is exactly 1 item, in the user's words", async () => {
    const { llm, calls } = scripted(OVER_SPLIT);
    const items = await splitRequest(llm, ASK);
    expect(items).toEqual([
      {
        text: "Add a comment at the top of the main page explaining what it shows",
        needs_clarification: false,
      },
    ]);
    expect(calls[0]?.system).toBe(CHECKLIST_SYSTEM);
    expect(calls[0]?.prompt).toBe(checklistPrompt(ASK));
  });

  it("request capture gives the same single item for the same request", async () => {
    const { llm } = scripted(`FEATURE: home\n${OVER_SPLIT}`);
    const got = await classifyRequest(llm, ASK, ["home"]);
    expect(got).toEqual({
      kind: "request",
      feature: "home",
      items: [
        {
          text: "Add a comment at the top of the main page explaining what it shows",
          needs_clarification: false,
        },
      ],
    });
  });

  it("both prompts ask for outcomes the user would check, never steps or rules, and 1 item for one purpose", () => {
    for (const system of [CHECKLIST_SYSTEM, CAPTURE_SYSTEM]) {
      expect(system).toMatch(/outcome the user would check/i);
      expect(system).toMatch(/never a step/i);
      expect(system).toMatch(/exactly one item/i);
    }
  });

  it("a longer request keeps its outcomes and drops steps and rules", () => {
    expect(
      parseChecklist(
        [
          "- Locate the reviews component",
          "- Open src/reviews/List.tsx and read it",
          "- The product page shows the average star rating",
          "- Each review shows its date",
          "- Keep the existing code unchanged",
          "- Follow the existing code style",
        ].join("\n"),
      ),
    ).toEqual([
      { text: "The product page shows the average star rating", needs_clarification: false },
      { text: "Each review shows its date", needs_clarification: false },
    ]);
  });

  it("security pass: a constraint the user asked for is an outcome and stays on the checklist", () => {
    const kept = parseChecklist(
      [
        "- Signup page exists",
        "- Do not store passwords in plain text",
        "- Don't expose the API key to the browser",
        "- Keep the admin page behind login",
        "- Avoid logging tokens",
      ].join("\n"),
    ).map((i) => i.text);
    expect(kept).toEqual([
      "Signup page exists",
      "Do not store passwords in plain text",
      "Don't expose the API key to the browser",
      "Keep the admin page behind login",
      "Avoid logging tokens",
    ]);
    expect(CHECKLIST_SYSTEM).toMatch(/a constraint the user asked for .* is an outcome/i);
  });

  it("a request with several purposes is not collapsed", async () => {
    const { llm } = scripted("- The header is dark blue\n- The footer shows the copyright year");
    const items = await splitRequest(
      llm,
      "Make the header dark blue and add the copyright year to the footer.",
    );
    expect(items.map((i) => i.text)).toEqual([
      "The header is dark blue",
      "The footer shows the copyright year",
    ]);
  });
});
