import { describe, expect, it } from "vitest";
import { receiptView } from "./fix-prompt";
import type { Llm } from "./llm";
import { buildReceipt } from "./receipt";
import { isCodeceiptSetupPath, withoutAgentsSection } from "./setup-files";

// First-receipt fixes: "Done, no test proves it" is its own state, apart from "Not verified"; Codeceipt's own setup
// files are never part of a receipt.
const llm = (answer: string): Llm => ({ complete: async () => answer });
const items = [
  { id: "i1", text: "Add the reviews list" },
  { id: "i2", text: "Add a star rating" },
  { id: "i3", text: "Email the owner" },
];
const file = (path: string) => ({ path, feature: "reviews", inScope: true });

describe("done, no test proves it", () => {
  it("an item judged done with file evidence but no changed test is done_untested; one without evidence stays not verified", async () => {
    const receipt = await buildReceipt(
      llm("1 | done | src/reviews/List.tsx\n2 | partial |\n3 | missed |"),
      items,
      [file("src/reviews/List.tsx")],
    );
    expect(receipt.items.map((i) => i.status)).toEqual(["done_untested", "not_verified", "missed"]);
    // Still listed in not_verified with its reason (AC-013-07: never plain "done" without a test).
    expect(receipt.not_verified).toEqual([
      { id: "i1", text: "Add the reviews list", reason: "no test changed" },
      { id: "i2", text: "Add a star rating", reason: "no file evidence" },
    ]);
  });

  it("an item done with a changed test is plain done", async () => {
    const receipt = await buildReceipt(
      llm("1 | done | src/reviews/List.tsx, src/reviews/List.test.tsx"),
      items,
      [file("src/reviews/List.tsx"), file("src/reviews/List.test.tsx")],
    );
    expect(receipt.items[0]?.status).toBe("done");
  });

  it("the receipt view shows done_untested apart from not verified, also for receipts stored before the split", () => {
    const stored = {
      items: [
        {
          id: "i1",
          text: "Add the reviews list",
          status: "not_verified",
          evidence: ["src/reviews/List.tsx"],
        },
        { id: "i2", text: "Add a star rating", status: "not_verified", evidence: [] },
        { id: "i3", text: "Sort", status: "done_untested", evidence: ["src/sort.ts"] },
      ],
      not_verified: [
        { id: "i1", text: "Add the reviews list", reason: "no test changed" },
        { id: "i2", text: "Add a star rating", reason: "no file evidence" },
        { id: "i3", text: "Sort", reason: "no test changed" },
      ],
    };
    const view = receiptView(stored);
    expect(view.items.map((i) => i.status)).toEqual([
      "done_untested",
      "not_verified",
      "done_untested",
    ]);
    expect(view.notVerified).toEqual([{ text: "Add a star rating", reason: "no file evidence" }]);
  });
});

describe("Codeceipt's own setup files", () => {
  it("every file init adds or changes counts as setup, and nothing else does", () => {
    for (const path of [
      ".mcp.json",
      ".claude/settings.json",
      ".claude/skills/codeceipt/SKILL.md",
      ".claude/skills/projectbrain/SKILL.md",
      ".cursor/mcp.json",
      ".cursor/hooks.json",
      ".cursor/rules/codeceipt.mdc",
      ".codex/config.toml",
      ".codex/hooks.json",
      "opencode.json",
      ".opencode/plugins/codeceipt.js",
      ".agents/mcp_config.json",
      ".agents/hooks.json",
      ".agents/rules/codeceipt.md",
      ".agents/skills/codeceipt/SKILL.md",
    ]) {
      expect([path, isCodeceiptSetupPath(path)]).toEqual([path, true]);
    }
    for (const path of [
      "AGENTS.md",
      "src/.mcp.json",
      ".claude/skills/deploy/SKILL.md",
      ".cursor/rules/style.mdc",
      ".agents/rules/style.md",
      ".opencode/plugins/other.js",
      ".claude/settings.local.json",
      "app/.codex/config.toml",
    ]) {
      expect([path, isCodeceiptSetupPath(path)]).toEqual([path, false]);
    }
  });

  it("AGENTS.md without its Codeceipt section: only the section init adds is removed", () => {
    const section = "<!-- codeceipt:start -->\n## Codeceipt\nx\n<!-- codeceipt:end -->";
    expect(withoutAgentsSection(`# Rules\nBe nice.\n\n${section}\n`)).toBe("# Rules\nBe nice.\n");
    expect(withoutAgentsSection(`${section}\n`)).toBe("");
    expect(withoutAgentsSection("# Rules\n")).toBe("# Rules\n");
  });
});
