import { describe, expect, it } from "vitest";
import { CHECKLIST_SYSTEM, parseChecklist, splitRequest } from "./checklist";
import type { Llm } from "./llm";
import { CAPTURE_SYSTEM } from "./request-capture";

// D-025: the splitter asks only when something cannot be built without guessing. A clear request ("Add a comment at
// the top of the main page") produces no question; wording the agent can choose is never a question.
const scripted = (answer: string): Llm => ({ complete: async () => answer });

describe("request splitter asks fewer questions", () => {
  it("both prompts say a request that names what and where is clear, and wording is never a question", () => {
    for (const system of [CHECKLIST_SYSTEM, CAPTURE_SYSTEM]) {
      expect(system).toContain("Add a comment at the top of the main page");
      expect(system).toMatch(/only when.*cannot be built without guessing/i);
      expect(system).toMatch(/never ask about wording/i);
    }
  });

  it("the edutech request: a question about wording next to a clear item is dropped", async () => {
    const items = await splitRequest(
      scripted("- Add a comment at the top of src/app/page.tsx\n? What should the comment say?"),
      "Add a comment at the top of the main page",
    );
    // One purpose: one item in the user's words (D-026), and the wording question is gone.
    expect(items).toEqual([
      { text: "Add a comment at the top of the main page", needs_clarification: false },
    ]);
    expect(
      parseChecklist(
        "- Add a footer\n? Which text should the footer contain?\n? What wording do you want?",
      ),
    ).toEqual([{ text: "Add a footer", needs_clarification: false }]);
  });

  it("a real question stays: a vague request, or a question about what to build", () => {
    expect(parseChecklist("? Which page should get the new design?")).toEqual([
      { text: "Which page should get the new design?", needs_clarification: true },
    ]);
    expect(
      parseChecklist("- Add a reviews list\n? Should reviews need approval before they show?"),
    ).toEqual([
      { text: "Add a reviews list", needs_clarification: false },
      { text: "Should reviews need approval before they show?", needs_clarification: true },
    ]);
  });
});
