// FEAT-029: things that looked broken. Placeholders, onboarding steps that tick in order, receipt badges without
// zero counts, deleting an account with a paid plan, admin status after suspend, AI unit cost, support links.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import QuickstartPage from "@/app/docs/quickstart/page";
import PrivacyPage from "@/app/privacy/page";
import ConnectPage from "@/app/projects/[id]/connect/page";
import SuspendedPage from "@/app/suspended/page";
import TermsPage from "@/app/terms/page";
import { JourneySteps } from "@/components/journey-steps";
import { ReceiptCard } from "@/components/receipt-card";
import { SUPPORT_ISSUES_URL, supportHref } from "@/lib/support";
import { receiptView } from "@brain/core";
import { projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccount } from "./account";
import type { SessionUser } from "./auth";
import { projectSteps } from "./onboarding";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/",
}));

const SRC = join(__dirname, "..");
let world: TestWorld;
let owner: SessionUser;
beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  world.signInAs(owner);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await world.teardown();
});

const html = async (el: unknown) => renderToStaticMarkup((await el) as ReactElement);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const card = (summary: unknown) =>
  renderToStaticMarkup(
    createElement(ReceiptCard, {
      receipt: {
        projectId: "proj-1",
        id: "rc-1",
        createdAt: "2026-11-20T12:00:00.000Z",
        asked: "Add reviews",
        commitSha: null,
        view: receiptView(summary),
        fixPrompt: null,
      },
      expanded: false,
    }),
  );
const badges = (h: string) =>
  [
    ...h.matchAll(
      /data-status="(\w+)"><span aria-hidden="true">[^<]+<\/span><span>([^<]+)<\/span>/g,
    ),
  ].map((m) => `${m[1]}|${m[2]}`);

describe("FEAT-029 trust fixes", () => {
  it("AC-029-01 privacy, terms and quickstart render no [REVIEW] note or [SCREENSHOT] box", async () => {
    for (const page of [PrivacyPage(), TermsPage(), QuickstartPage()]) {
      const t = text(await html(page));
      expect(t).not.toContain("[REVIEW]");
      expect(t).not.toContain("[SCREENSHOT");
      expect(t).not.toContain("REVIEW:");
    }
  });

  it("AC-029-02 steps are 'Connect this computer', 'Codeceipt reads your project', 'Get your first receipt'; a step before a done step is done", async () => {
    const titles = [
      ...renderToStaticMarkup(
        createElement(JourneySteps, { steps: { linked: false, indexed: false, receipt: false } }),
      ).matchAll(/<h2[^>]*>(?:<!-- -->)?\d(?:<!-- -->)?\. (?:<!-- -->)?([^<]+)<\/h2>/g),
    ].map((m) => m[1]);
    expect(titles).toEqual([
      "Connect this computer",
      "Codeceipt reads your project",
      "Get your first receipt",
    ]);
    // A receipt arrived (for example from a GitHub push) before this computer was linked or indexed.
    const project = await projectsRepo.create(world.db, owner.id, { name: "shop" });
    const { request } = await requestsRepo.createWithItems(
      world.db,
      project.id,
      { featureId: null, text: "Add a footer" },
      [{ text: "Add a footer", needsClarification: false }],
    );
    await receiptsRepo.insert(world.db, project.id, {
      requestId: request.id,
      summaryJson: { items: [] },
    } as never);
    const s = await projectSteps(world.db, owner, project.id, false);
    expect(s.steps).toEqual({ linked: true, indexed: true, receipt: true });
    const page = await html(ConnectPage({ params: Promise.resolve({ id: project.id }) }));
    expect([...page.matchAll(/data-step="(\d)" data-status="(\w+)"/g)].map((m) => m[2])).toEqual([
      "done",
      "done",
      "done",
    ]);
  });

  it("AC-029-03 summaries hide zero counts, say 'All done' when nothing is wrong, and use singular and plural", () => {
    const good = badges(
      card({ items: [{ id: "a", text: "List", status: "done", evidence: ["src/List.tsx"] }] }),
    );
    expect(good).toEqual(["done|All done"]);
    const mixed = badges(
      card({
        items: [
          { id: "a", text: "List", status: "done", evidence: ["src/List.tsx"] },
          { id: "b", text: "Empty state", status: "missed", evidence: [] },
        ],
        findings: [{ type: "secret", file: "src/a.ts", masked_value: "sb_s***" }],
      }),
    );
    expect(mixed).toContain("done|1 done");
    expect(mixed).toContain("missed|1 missed");
    expect(mixed.join(" ")).not.toMatch(/\b0 (missed|partly done|done)\b/);
    expect(mixed.join(" ")).not.toContain("findings");
    const one = text(
      card({
        items: [{ id: "a", text: "List", status: "done", evidence: ["src/List.tsx"] }],
        findings: [{ type: "secret", file: "src/a.ts", masked_value: "sb_s***" }],
      }),
    );
    expect(one).toMatch(/1 security problem\b/);
    expect(one).not.toContain("1 security problems");
  });

  it("AC-029-04 negative: a user with an active paid plan is told to cancel in Manage billing first, never 'Reload the page'", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", ["sk", "test", "trust"].join("_"));
    const { billingRepo } = await import("@brain/db");
    await billingRepo.upsert(world.db, owner.id, {
      plan: "pro",
      status: "active",
      founding: false,
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      currentPeriodEnd: new Date(Date.now() + 86400_000),
      cancelAtPeriodEnd: false,
    });
    await expect(deleteAccount(world.db, owner, { confirm: "owner" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("Cancel your plan in Manage billing first"),
    });
    const page = readFileSync(join(SRC, "app/account/page.tsx"), "utf8");
    expect(page).toContain('data-testid="delete-needs-cancel"');
    expect(page).toContain("Cancel your plan in Manage billing first, then delete the account.");
    const client = readFileSync(join(SRC, "components/account/delete-account.tsx"), "utf8");
    expect(client).toMatch(/r\.status === 409\s*\?/);
  });

  it("AC-029-05 suspending or restoring refreshes the page's badges; AI usage shows unit costs with 4 decimals", () => {
    const button = readFileSync(join(SRC, "components/admin/suspend-button.tsx"), "utf8");
    expect(button).toMatch(/setState\(!state\);[\s\S]*router\.refresh\(\);/);
    const ai = readFileSync(join(SRC, "app/admin/ai/page.tsx"), "utf8");
    expect(ai).toContain("const unitUsd = (n: number) => `$${n.toFixed(4)}`;");
    expect(ai).toContain("${unitUsd(u.costPerCall)} a call");
    expect((0.0012).toFixed(4)).toBe("0.0012");
  });

  it("AC-029-06 Contact support is a working link; the Connect tab's keys link opens the keys page", async () => {
    expect(supportHref()).toBe(SUPPORT_ISSUES_URL);
    vi.stubEnv("SUPPORT_EMAIL", "help@codeceipt.example");
    expect(supportHref()).toBe("mailto:help@codeceipt.example");
    vi.stubEnv("SUPPORT_EMAIL", "not an email");
    expect(supportHref()).toBe(SUPPORT_ISSUES_URL);
    const suspended = await html(SuspendedPage({ searchParams: Promise.resolve({}) }));
    expect(suspended).toContain(`<a href="${SUPPORT_ISSUES_URL}">contact support</a>`);
    const project = await projectsRepo.create(world.db, owner.id, { name: "shop" });
    const connect = await html(ConnectPage({ params: Promise.resolve({ id: project.id }) }));
    // The keys page is the project's own page (the Tokens tab, href "").
    expect(connect).toContain(`<a href="/projects/${project.id}">Tokens</a>`);
  });
});
