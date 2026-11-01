import { AgentTabs } from "@/components/landing/agent-tabs";
import { CommandBox } from "@/components/landing/command-box";
import { AGENT_TABS, STATES, STEPS } from "@/components/landing/content";
import { HowTerminal } from "@/components/landing/how-terminal";
import { PrivacyToggle } from "@/components/landing/privacy-toggle";
import { ReceiptStates } from "@/components/landing/receipt-states";
import { tabAfterKey } from "@/lib/ui-helpers";
import { copyLabel } from "@/lib/ui-helpers";
import { totalTicks, visibleLines } from "@/lib/ui-helpers";
import { EXAMPLE_EVIDENCE } from "@/lib/ui-helpers";
import { linesFor } from "@/lib/ui-helpers";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// The landing page's client islands (2026-11-01): tabs, the terminal stepper, the receipt states, the privacy toggle
// and the copy box. Rendered on the server, plus the pure functions their clicks and keys run.
const html = (c: () => unknown) => renderToStaticMarkup(createElement(c as () => null));
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("agent tabs", () => {
  it("are WAI-ARIA tabs: a tablist, five tabs each controlling its panel, one selected and focusable", () => {
    const h = html(AgentTabs);
    expect(h).toContain('role="tablist" aria-label="Agents"');
    const tabs = [
      ...h.matchAll(
        /role="tab" id="tab-(\w+)" aria-selected="(true|false)" aria-controls="panel-(\w+)" tabindex="(-?\d)"/g,
      ),
    ];
    expect(tabs.map((m) => m[1])).toEqual(["claude", "cursor", "codex", "opencode", "antigravity"]);
    expect(tabs.map((m) => m[2])).toEqual(["true", "false", "false", "false", "false"]);
    expect(tabs.every((m) => m[1] === m[3])).toBe(true);
    expect(tabs.map((m) => m[4])).toEqual(["0", "-1", "-1", "-1", "-1"]);
    for (const a of AGENT_TABS) {
      expect(h).toContain(`role="tabpanel" id="panel-${a.id}" aria-labelledby="tab-${a.id}"`);
    }
    // Only the selected panel shows; the others are in the page (for search and no-JS) but hidden.
    expect(h.match(/role="tabpanel"[^>]*hidden=""/g)).toHaveLength(4);
  });

  it("arrow keys wrap, Home and End jump, other keys do nothing", () => {
    expect(tabAfterKey("ArrowRight", 0, 5)).toBe(1);
    expect(tabAfterKey("ArrowRight", 4, 5)).toBe(0);
    expect(tabAfterKey("ArrowLeft", 0, 5)).toBe(4);
    expect(tabAfterKey("Home", 3, 5)).toBe(0);
    expect(tabAfterKey("End", 1, 5)).toBe(4);
    expect(tabAfterKey("Enter", 1, 5)).toBeNull();
    expect(tabAfterKey("a", 1, 5)).toBeNull();
  });

  it("say honestly what is automatic: OpenCode and Antigravity make receipts with `codeceipt receipt`", () => {
    const h = text(html(AgentTabs));
    const auto = AGENT_TABS.filter((a) => a.receipt).map((a) => a.name);
    expect(auto).toEqual(["Claude Code", "Cursor", "Codex"]);
    for (const a of AGENT_TABS.filter((x) => !x.receipt))
      expect(a.how).toContain("`codeceipt receipt`");
    expect(AGENT_TABS.find((a) => a.id === "antigravity")?.capture).toBe(false);
    expect(h).toContain("Receipt at session end: automatic");
    expect(h).toContain("Request capture: not automatic");
  });
});

describe("how it works: the terminal stepper", () => {
  it("has three step buttons, the first pressed, and shows its output complete without playing", () => {
    const h = html(HowTerminal);
    const steps = [
      ...h.matchAll(
        /<button type="button" class="how-step" aria-pressed="(true|false)" aria-controls="how-terminal">/g,
      ),
    ];
    expect(steps.map((m) => m[1])).toEqual(["true", "false", "false"]);
    expect(text(h)).toContain("Set up");
    expect(text(h)).toContain("Get your receipt");
    expect(h).toContain('data-playing="false"');
    expect(h).not.toContain("t-cursor");
    // The animated text is hidden from screen readers, which get the full transcript instead.
    expect(h).toContain('class="terminal-body" aria-hidden="true"');
    expect(text(h)).toContain("Terminal for step 1, Set up:");
  });

  it("plays real CLI output: the approval code and summary, a Claude Code session, then `codeceipt last --evidence`", () => {
    const all = STEPS.map((s) => s.lines.map((l) => l.text).join("\n"));
    expect(all[0]).toMatch(/^npx codeceipt\nYour code: [A-Z]{4}-[A-Z]{4}\n/);
    expect(all[0]).toContain("Codeceipt is set up for this repo.");
    expect(all[0]).toContain("What happens next:");
    expect(STEPS[1]?.lines[0]).toEqual({ kind: "cmd", text: "claude" });
    expect(all[2]).toContain("codeceipt last --evidence");
    expect(all[2]).toContain("Evidence sent to the judge (no source code):");
    expect(all[2]).toMatch(/: \+5 -0, comment only, top of file \(outside the request's feature\)/);
  });

  it("types commands a character at a time, shows output lines whole, and ends complete", () => {
    const lines = STEPS[0]?.lines ?? [];
    expect(visibleLines(lines, 0)).toEqual([]);
    expect(visibleLines(lines, 3)).toEqual([{ kind: "cmd", text: "npx" }]);
    const end = totalTicks(lines);
    expect(visibleLines(lines, end)).toEqual(lines);
    expect(visibleLines(lines, end + 50)).toEqual(lines);
    // Every frame only adds: nothing jumps back.
    for (let t = 1; t <= end; t++) {
      expect(visibleLines(lines, t).length).toBeGreaterThanOrEqual(
        visibleLines(lines, t - 1).length,
      );
    }
    // Short: every step plays in under 2.5 seconds.
    for (const s of STEPS) expect(totalTicks(s.lines) * 18).toBeLessThan(2500);
  });
});

describe("read a receipt: states", () => {
  it("has one button per state, Done pressed, and a sentence that explains it", () => {
    const h = html(ReceiptStates);
    const pressed = [...h.matchAll(/class="state-button" aria-pressed="(true|false)"/g)].map(
      (m) => m[1],
    );
    expect(pressed).toHaveLength(7);
    expect(pressed.filter((p) => p === "true")).toHaveLength(1);
    expect(STATES.map((s) => s.label)).toEqual([
      "Done",
      "Done, no test proves it",
      "Not verified",
      "Missed",
      "Question",
      "Outside the request",
      "Already in your working tree",
    ]);
    expect(h).toContain('data-active="done"');
    expect(text(h)).toContain("Done: The changed files show this part of your request was built.");
    expect(h).toContain('aria-live="polite"');
  });

  it("every state highlights at least one receipt line, and each state has one plain sentence", () => {
    for (const s of STATES) {
      expect(linesFor(s.key).length).toBeGreaterThan(0);
      expect(s.meaning).toMatch(/^[A-Z][^.]*\.$/);
    }
    const h = html(ReceiptStates);
    expect(h.match(/data-match="true"/g)).toHaveLength(linesFor("done").length);
  });
});

describe("what leaves your machine", () => {
  it("the toggle starts closed and shows the evidence line next to the code labelled 'stays on your computer'", () => {
    const h = html(PrivacyToggle);
    expect(h).toContain('aria-pressed="false" aria-controls="privacy-compare"');
    expect(h).toMatch(/id="privacy-compare" class="privacy-compare" hidden=""/);
    expect(text(h)).toContain("Stays on your computer");
    expect(text(h)).toContain(EXAMPLE_EVIDENCE);
    expect(EXAMPLE_EVIDENCE).toContain("+5 -0, comment only, top of file");
  });
});

describe("the copy box", () => {
  it("is a real button with the command and a live region; it says Copy, then Copied or Copy failed", () => {
    const h = renderToStaticMarkup(createElement(CommandBox, { command: "npx codeceipt" }));
    expect(h).toContain(
      '<button type="button" class="command-copy" data-copy="npx codeceipt" aria-label="Copy npx codeceipt">Copy</button>',
    );
    expect(h).toContain('<output aria-live="polite"');
    expect(h).toMatch(/<span aria-hidden="true" class="command-prompt">\$ <\/span>npx codeceipt/);
    expect(copyLabel("idle")).toBe("Copy");
    expect(copyLabel("copied")).toBe("Copied");
    expect(copyLabel("failed")).toBe("Copy failed");
  });
});
