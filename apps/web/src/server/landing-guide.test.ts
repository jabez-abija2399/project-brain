import { INSTALL_SH, nativeReleased } from "@/components/install-options";
import { Landing } from "@/components/landing/landing";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Owner, 2026-11-02: the landing page's "how to use" section is a clear step-by-step guide. Every step's instructions
// are on the page without clicking anything; the terminal stays as a demo of each step.
const page = () => renderToStaticMarkup(createElement(Landing));
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
const section = (h: string) =>
  h.slice(h.indexOf('id="how"'), h.indexOf("</section>", h.indexOf('id="how"')));

describe("landing: how to use Codeceipt", () => {
  it("says what you need before you start: Node.js 20 or newer, a git repository and a supported agent", () => {
    const t = text(section(page()));
    expect(t).toContain("How to use Codeceipt");
    expect(t).toContain("Before you start");
    expect(t).toMatch(/Node\.js 20 or newer/);
    expect(t).toMatch(/git repository/);
    expect(t).toMatch(/Claude Code, Cursor, Codex, OpenCode or Antigravity/);
  });

  it("lists every step's instructions on the page, without clicking: set up, work, read the receipt", () => {
    const h = section(page());
    const steps = [
      ...h.matchAll(
        /<li class="guide-step"[\s\S]*?<\/li>\s*<\/ol>\s*(?:<p[\s\S]*?<\/p>\s*)?<\/li>/g,
      ),
    ].map((m) => text(m[0]));
    expect(steps).toHaveLength(3);
    const [setup, work, receipt] = steps as [string, string, string];
    // 1. Set up, once per repository.
    expect(setup).toContain("Set up");
    expect(setup).toContain("npx codeceipt");
    expect(setup).toMatch(/your app's folder/);
    expect(setup).toMatch(/same code/);
    expect(setup).toMatch(/Approve/);
    // 2. Work as usual, then end the session.
    expect(work).toMatch(/Start your agent in the same folder/);
    expect(work).toMatch(/in your own words/);
    expect(work).toMatch(/End the session/);
    expect(work).toContain("/exit");
    // 3. Read the receipt and act on it.
    expect(receipt).toContain("codeceipt last");
    expect(receipt).toMatch(/Receipts page/);
    expect(receipt).toMatch(/Send fix to agent/);
  });

  it("each step has a numbered list of what to do, and the guide links to troubleshooting", () => {
    const h = section(page());
    const lists = [...h.matchAll(/<ol class="guide-do">([\s\S]*?)<\/ol>/g)].map(
      (m) => (m[1]?.match(/<li>/g) ?? []).length,
    );
    expect(lists).toHaveLength(3);
    for (const n of lists) expect(n).toBeGreaterThanOrEqual(2);
    expect(h).toContain('href="/docs/quickstart#troubleshooting"');
  });

  it("keeps the terminal demo for each step, and still only `npx codeceipt` has copy buttons on the page", () => {
    const h = page();
    expect(section(h)).toContain('id="how-terminal"');
    // D-027 (owner, 2026-11-02): the one-line installer goes first once a native release is pinned.
    const first = nativeReleased() ? INSTALL_SH : "npx codeceipt";
    expect([...h.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1])).toEqual([first, first]);
  });
});
