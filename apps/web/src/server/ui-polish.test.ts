// FEAT-039: UI polish after the review of 2026-11-25. The phone menu has a label and the tabs wrap; a project's own
// address opens its Overview; Receipts and To decide lead with their groups; Features and Blueprint stop showing
// misleading zeros and checks; Account puts the plan first; a refreshed look that still uses tokens only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AccountPage from "@/app/account/page";
import BlueprintPage from "@/app/projects/[id]/blueprint/page";
import DecidePage from "@/app/projects/[id]/decide/page";
import FeatureBoardPage from "@/app/projects/[id]/features/page";
import OverviewPage from "@/app/projects/[id]/overview/page";
import ReceiptsPage from "@/app/projects/[id]/receipts/page";
import {
  featuresRepo,
  projectTokensRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
} from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { agentAsk } from "./approvals";
import type { SessionUser } from "./auth";
import { proposeChecklistChange } from "./checklist";
import { navCounts } from "./nav-counts";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}));

const SRC = join(__dirname, "..");
const css = () => readFileSync(join(SRC, "app/globals.css"), "utf8");
let world: TestWorld;
let owner: SessionUser;
let pid: string;
beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "Maya" });
  world.signInAs(owner);
  pid = (await projectsRepo.create(world.db, owner.id, { name: "salon" })).id;
});
afterEach(async () => {
  await world.teardown();
});

const props = (id = pid) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve({}),
});
const html = async (el: unknown) => renderToStaticMarkup((await el) as ReactElement);
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
// The last rule for a selector wins; return the CSS after its last occurrence.
const lastRule = (sheet: string, selector: string) => sheet.slice(sheet.lastIndexOf(selector));
// WCAG contrast of two #rrggbb colours.
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, b2] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b2 as number);
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

async function receipts() {
  const { request } = await requestsRepo.createWithItems(
    world.db,
    pid,
    { featureId: null, text: "Add reviews" },
    [{ text: "Empty state", needsClarification: false }],
  );
  const base = { files_by_feature: [], outside_scope: [], not_verified: [] };
  await receiptsRepo.insert(world.db, pid, {
    requestId: request.id,
    commitSha: null,
    summaryJson: {
      ...base,
      items: [{ id: "m", text: "Empty state", status: "missed", evidence: [] }],
    },
  });
  const r2 = await requestsRepo.insert(world.db, pid, { text: "Add a footer" });
  await receiptsRepo.insert(world.db, pid, {
    requestId: r2.id,
    commitSha: null,
    summaryJson: { ...base, items: [{ id: "g", text: "Footer", status: "done", evidence: [] }] },
  });
}

describe("FEAT-039 UI polish", () => {
  it("AC-039-01 on a phone the account menu says 'Menu' and every project tab wraps into view", async () => {
    const sheet = css();
    // The phone rule comes after the base rule that hides the short label, so it wins.
    expect(
      sheet.lastIndexOf("@media (max-width: 560px) {\n  .user-menu-short {\n    display: inline;"),
    ).toBeGreaterThan(sheet.indexOf(".user-menu-short,\n.user-menu-docs {\n  display: none;"));
    const menu = readFileSync(join(SRC, "components/shell/user-menu.tsx"), "utf8");
    expect(menu).toContain('<span className="user-menu-short" aria-hidden="true">');
    const nav = lastRule(sheet, ".project-nav,\n.project-nav.project-nav[data-end] {");
    expect(nav).toMatch(/flex-wrap: wrap;/);
    expect(nav).toMatch(/overflow: visible;/);
  });

  it("AC-039-02 a project's own address opens its Overview", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    expect(redirects.find((r) => r.source === "/projects/:id")).toEqual({
      source: "/projects/:id",
      destination: "/projects/:id/overview",
      permanent: false,
    });
  });

  it("AC-039-03 Receipts: groups lead, dates are smaller, the guide starts closed, actions are buttons, one shortcut hint", async () => {
    await receipts();
    const page = await html(ReceiptsPage(props()));
    const group = page.indexOf('class="group-title m0"');
    const day = page.indexOf('<h3 class="day-label m0">');
    expect(group).toBeGreaterThan(-1);
    expect(day).toBeGreaterThan(group);
    expect(page).toMatch(/<details class="state-guide">/);
    expect(page).not.toMatch(/<details class="state-guide" open/);
    expect(page).not.toContain("next and previous");
    expect(page).toContain("<kbd>?</kbd> all shortcuts");
    expect(page).toMatch(/class="btn btn-secondary btn-sm"[^>]*>Share a read-only link/);
    expect(page).not.toMatch(/class="btn btn-ghost"[^>]*>(Close|Dismiss|Share a read-only link)</);
  });

  it("AC-039-04 To decide: one heading whose count equals the tab badge, one list of cards, Approve and Reject on each", async () => {
    const token = await projectTokensRepo.create(world.db, pid);
    await agentAsk(world.db, pid, { action: "delete_feature", summary: "Remove the old cart" });
    const { items } = await requestsRepo.createWithItems(
      world.db,
      pid,
      { featureId: null, text: "Add reviews" },
      [{ text: "Show the reviews", needsClarification: false }],
    );
    await proposeChecklistChange(world.db, token.row as never, {
      itemId: items[0]?.id as string,
      text: "Show the 10 newest reviews",
    });
    const page = await html(DecidePage(props()));
    const counts = await navCounts(world.db, owner, pid);
    expect(text(page)).toContain(`Waiting for you ${counts?.decide}`);
    expect(counts?.decide).toBe(2);
    expect(page).not.toContain("Waiting for you: ");
    expect(page).toContain('aria-label="Approve: Remove the old cart"');
    expect(page.match(/>Approve</g)?.length).toBeGreaterThanOrEqual(1);
    expect(page.match(/>Reject</g)?.length).toBeGreaterThanOrEqual(2);
    const actions = readFileSync(
      join(SRC, "app/projects/[id]/proposals/proposal-actions.tsx"),
      "utf8",
    );
    expect(actions).toMatch(/Approve\s*<\/Button>/);
    expect(actions).not.toMatch(/>\s*Confirm\s*</);
  });

  it("AC-039-05 Features: 'Nothing planned' instead of a green check, no all-zero Files column, dates on one line", async () => {
    await featuresRepo.insert(world.db, pid, { name: "Billing", key: "billing" });
    const page = await html(FeatureBoardPage(props()));
    expect(text(page)).toContain("Nothing planned");
    expect(page).not.toContain("None open");
    expect(page).not.toMatch(/<th[^>]*>Files<\/th>/);
    expect(css()).toMatch(/\.receipt-when time \{\s*white-space: nowrap;/);
  });

  it("AC-039-06 Blueprint with no promises: one empty state with one primary action, no card per part", async () => {
    await featuresRepo.insert(world.db, pid, { name: "Booking", key: "booking" });
    await featuresRepo.insert(world.db, pid, { name: "Payments", key: "payments" });
    const page = await html(BlueprintPage(props() as never));
    expect(page.match(/data-testid="empty-state"/g)).toHaveLength(1);
    expect(text(page)).toContain("No promises yet");
    expect(page).not.toContain("has no promises yet");
    expect(page.match(/btn-primary/g)).toHaveLength(1);
    expect(page).toContain(`href="/projects/${pid}/blueprint/discover">Suggest promises</a>`);
  });

  it("AC-039-07 Account: profile, then plan, then keys and browsers, then the celebrations preference", async () => {
    const page = await html(AccountPage());
    const at = (s: string) => page.indexOf(s);
    expect(at('aria-labelledby="who"')).toBeLessThan(at('data-testid="plan-card"'));
    expect(at('data-testid="plan-card"')).toBeLessThan(at('aria-labelledby="computers"'));
    expect(at('aria-labelledby="computers"')).toBeLessThan(at('aria-labelledby="sessions"'));
    expect(at('aria-labelledby="sessions"')).toBeLessThan(at('aria-labelledby="celebrate"'));
  });

  it("AC-039-08 the refreshed look uses tokens only: torn-edge receipts, solid count badges at 4.5:1 in light and dark, no gradients", () => {
    const sheet = css();
    expect(sheet).not.toMatch(/gradient\(/);
    expect(sheet).toMatch(/\.receipt-card::after \{[^}]*clip-path: polygon\(/);
    expect(lastRule(sheet, ".tab-badge {")).toMatch(
      /background: var\(--accent\);\s*color: var\(--on-accent\);/,
    );
    const token = (scope: string, name: string) =>
      (scope.match(new RegExp(`--${name}: (#[0-9a-f]{6});`)) ?? [])[1] as string;
    const light = sheet.slice(0, sheet.indexOf("@media (prefers-color-scheme: dark)"));
    const dark = sheet.slice(sheet.indexOf("@media (prefers-color-scheme: dark)"));
    for (const scope of [light, dark]) {
      expect(contrast(token(scope, "accent"), token(scope, "on-accent"))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(token(scope, "muted"), token(scope, "surface-2"))).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("AC-039-09 boundary: nothing new can push a page wider than a 375 px phone", () => {
    const sheet = css();
    const polish = sheet.slice(sheet.indexOf("FEAT-039: UI polish"));
    for (const m of polish.matchAll(/(?:^|[\s;{])(min-width|width):\s*(\d+)px/g)) {
      expect(Number(m[2])).toBeLessThanOrEqual(375);
    }
    // The tab bar wraps instead of scrolling, so no tab is ever off-screen.
    expect(polish).not.toMatch(/\.project-nav[^{]*\{[^}]*overflow-x: auto/);
  });

  it("AC-039-10 permission: after the redirect, another user's project or a made-up id is the 404 page", async () => {
    world.signInAs(await world.createUser({ name: "stranger" }));
    for (const id of [pid, "not-a-real-id"]) {
      const err = await html(OverviewPage(props(id) as never)).catch((e: unknown) => e);
      expect(String((err as { digest?: string }).digest ?? err)).toContain("404");
    }
  });
});
