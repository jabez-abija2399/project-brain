// FEAT-033: receipts lead with a sentence and at most 3 badges, the feed is grouped by who has to act, the fix is
// copied with a clear confirmation, search says when nothing matches, "?" lists the shortcuts, a perfect receipt is
// stamped (unless celebrations are off), and receipt text is always shown as text.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ReceiptsPage from "@/app/projects/[id]/receipts/page";
import { ShellLayout } from "@/app/shell-layout";
import { ReceiptCard } from "@/components/receipt-card";
import { ReceiptsFilter } from "@/components/receipts-filter";
import { receiptView } from "@brain/core";
import { projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

let celebrateCookie: string | undefined;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (n: string) =>
      n === "codeceipt_celebrate" && celebrateCookie ? { value: celebrateCookie } : undefined,
  }),
}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/",
}));

const SRC = join(__dirname, "..");
let world: TestWorld;
let owner: SessionUser;
let pid: string;
beforeEach(async () => {
  celebrateCookie = undefined;
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  world.signInAs(owner);
  pid = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
});
afterEach(async () => {
  await world.teardown();
});

const card = (summary: unknown, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(ReceiptCard, {
      receipt: {
        projectId: pid,
        id: "rc-1",
        createdAt: "2026-11-20T12:00:00.000Z",
        asked: "Add reviews",
        commitSha: null,
        view: receiptView(summary),
        fixPrompt: "Fix: the empty state",
        ...extra,
      },
      expanded: true,
    }),
  );
const summaryOf = (h: string) => h.slice(h.indexOf("<summary"), h.indexOf("</summary>"));
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

async function receipt(requestText: string, summary: Record<string, unknown>, requestId?: string) {
  const request = requestId
    ? { id: requestId }
    : await requestsRepo.insert(world.db, pid, { text: requestText });
  await receiptsRepo.insert(world.db, pid, {
    requestId: request.id,
    commitSha: null,
    summaryJson: { files_by_feature: [], outside_scope: [], not_verified: [], ...summary },
  });
  return request.id;
}
const missed = { items: [{ id: "m", text: "Empty state", status: "missed", evidence: [] }] };
const good = { items: [{ id: "g", text: "Footer", status: "done", evidence: [] }] };

describe("FEAT-033 receipts", () => {
  it("AC-033-01 each summary is a verdict sentence and at most 3 badges; the commit sits in the body", () => {
    const html = card(
      {
        items: [
          { id: "a", text: "List", status: "done", evidence: [] },
          { id: "b", text: "Empty state", status: "missed", evidence: [] },
          { id: "c", text: "Sort", status: "partial", evidence: [] },
        ],
        findings: [{ type: "secret", file: "src/a.ts", masked_value: "sb_s***" }],
        outside_scope: [{ path: "src/pay.ts" }],
      },
      { commitSha: "abc1234def56" },
    );
    const summary = summaryOf(html);
    expect(text(summary)).toContain("Needs a look: 1 security problem, 1 missed, 1 partly done");
    expect((summary.match(/data-status="/g) ?? []).length).toBeLessThanOrEqual(3);
    expect(summary).toContain("+");
    expect(summary).not.toContain("abc1234def56");
    expect(html).toContain("<code>abc1234def56</code>");
    expect(text(html)).toContain("These changes are already in your files.");
  });

  it("AC-033-02 the feed groups Needs you / Agent is fixing / All good; the fix button copies with a clear confirmation", async () => {
    const redoneRequest = await receipt("Add reviews", missed);
    await receipt("Add a footer", good);
    await receipt("Add reviews again", missed, redoneRequest);
    await receipt("Add payments", missed);
    const html = renderToStaticMarkup(
      (await ReceiptsPage({
        params: Promise.resolve({ id: pid }),
        searchParams: Promise.resolve({}),
      })) as ReactElement,
    );
    const groups = [...html.matchAll(/data-group="(\w+)"/g)].map((m) => m[1]);
    expect(groups).toEqual(["you", "fixing", "good"]);
    // FEAT-039: the count sits in a pill next to the group title.
    expect(text(html)).toContain("Needs you 2");
    expect(text(html)).toContain("Agent is fixing 1");
    expect(text(html)).toContain("All good 1");
    expect(html).toContain(">Copy fix for your agent</button>");
    const cardHtml = card(missed);
    expect(cardHtml).toContain(">Copy fix for your agent</button>");
    const source = readFileSync(join(SRC, "components/receipt-card.tsx"), "utf8");
    expect(source).toContain('copied="Copied. Paste it into Claude Code or Cursor."');
  });

  it("AC-033-03 a search or filter with no matches says so with a way back; '?' opens the shortcut sheet", () => {
    const empty = renderToStaticMarkup(createElement(ReceiptsFilter, { total: 0, attention: 0 }));
    expect(empty).toContain('data-testid="no-match"');
    expect(text(empty)).toContain("No receipts in this view. Show all");
    const source = readFileSync(join(SRC, "components/receipts-filter.tsx"), "utf8");
    expect(source).toContain("No receipts match &ldquo;{query}&rdquo;.");
    expect(source).toContain('{query ? "Clear search" : "Show all"}');
    expect(source).toMatch(
      /if \(e\.key === "\?"\) \{\s*e\.preventDefault\(\);\s*setHelp\(\(h\) => !h\);/,
    );
    const bar = renderToStaticMarkup(createElement(ReceiptsFilter, { total: 2, attention: 1 }));
    expect(bar).toContain("<kbd>?</kbd> all shortcuts");
    expect(bar).toMatch(
      /<section id="shortcut-help"[^>]*aria-label="Keyboard shortcuts"[^>]*hidden=""/,
    );
    expect(text(bar)).toContain("Show or hide this list (Escape closes it)");
  });

  it("AC-033-04 a perfect receipt prints an 'All N items done' stamp; the Account switch turns celebrations off everywhere", async () => {
    const html = card({
      items: [
        { id: "a", text: "List", status: "done", evidence: [] },
        { id: "b", text: "Stars", status: "done", evidence: [] },
      ],
    });
    expect(html).toContain(
      'class="done-stamp print-once m0" data-testid="done-stamp">All 2 items done</p>',
    );
    expect(card(missed)).not.toContain("done-stamp");
    const shell = async () =>
      renderToStaticMarkup(
        (await ShellLayout({ children: createElement("main", null, "x") })) as ReactElement,
      );
    expect(await shell()).toContain('data-celebrate="on"');
    celebrateCookie = "off";
    expect(await shell()).toContain('data-celebrate="off"');
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    expect(css).toMatch(/\[data-celebrate="off"\] \.done-stamp \{\s*display: none;/);
    expect(css).toMatch(/\[data-celebrate="off"\] \.print-once \{\s*animation: none;/);
    const account = readFileSync(join(SRC, "app/account/page.tsx"), "utf8");
    expect(account).toContain("<CelebrateToggle on={await celebrateOn()} />");
  });

  it("AC-033-05 negative: request text and file names are shown as text, never as HTML", async () => {
    const html = card(
      {
        items: [
          { id: "a", text: '<img src=x onerror="alert(1)">', status: "missed", evidence: [] },
        ],
        outside_scope: [{ path: "src/<script>x</script>.ts" }],
      },
      { asked: "<script>alert(1)</script>" },
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
