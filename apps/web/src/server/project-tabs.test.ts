// FEAT-030: six project tabs (Overview, Receipts, Features, To decide, Blueprint, Settings) with counts, Settings
// holding Connect, Connection keys, approvals and Delete, and the old addresses redirecting with a 308.
import DecidePage from "@/app/projects/[id]/decide/page";
import { NavCountsProvider } from "@/app/projects/[id]/nav-counts";
import { ProjectNav } from "@/app/projects/[id]/project-nav";
import SettingsPage from "@/app/projects/[id]/settings/page";
import { projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { agentAsk } from "./approvals";
import type { SessionUser } from "./auth";
import { resetMigrationCheckForTests } from "./migration-check";
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

let world: TestWorld;
let owner: SessionUser;
let pid: string;
beforeEach(async () => {
  resetMigrationCheckForTests();
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  pid = (await projectsRepo.create(world.db, owner.id, { name: "Shop" })).id;
  world.signInAs(owner);
});
afterEach(async () => {
  resetMigrationCheckForTests();
  await world.teardown();
});

const nav = (counts: { receipts: number; decide: number } | null) =>
  renderToStaticMarkup(
    createElement(
      NavCountsProvider,
      { value: counts },
      createElement(ProjectNav, { projectId: pid, current: "overview", name: "Shop" }),
    ),
  );
const tabs = (html: string) =>
  [
    ...html
      .slice(html.indexOf('aria-label="Project"'))
      .matchAll(/<a [^>]*href="[^"]+\/(\w+)"[^>]*>([^<]+)/g),
  ].map((m) => `${m[1]}:${m[2]}`);
const page = async (el: Promise<unknown>) => renderToStaticMarkup((await el) as ReactElement);

async function attentionReceipt(projectId: string) {
  const { request } = await requestsRepo.createWithItems(
    world.db,
    projectId,
    { featureId: null, text: "Add reviews" },
    [{ text: "Add reviews", needsClarification: false }],
  );
  await receiptsRepo.insert(world.db, projectId, {
    requestId: request.id,
    summaryJson: { items: [{ id: "a", text: "Empty state", status: "missed", evidence: [] }] },
  } as never);
}

describe("FEAT-030 project navigation", () => {
  it("AC-030-01 the tabs are Overview, Receipts, Features, To decide, Blueprint, Settings; Receipts and To decide show a count when something waits", () => {
    const html = nav({ receipts: 2, decide: 3 });
    expect(tabs(html)).toEqual([
      "overview:Overview",
      "receipts:Receipts",
      "features:Features",
      "decide:To decide",
      "blueprint:Blueprint",
      "settings:Settings",
    ]);
    expect(html).toContain('<span class="tab-badge" aria-label="2 need your attention"');
    expect(html).toContain('<span class="tab-badge" aria-label="3 waiting for you"');
    expect(nav({ receipts: 0, decide: 0 })).not.toContain("tab-badge");
    expect(nav(null)).not.toContain("tab-badge");
  });

  it("AC-030-02 Settings holds Connect, Connection keys, what agents may do alone, and Delete project", async () => {
    const html = await page(SettingsPage({ params: Promise.resolve({ id: pid }) }));
    expect(html).toContain('id="connect-title"');
    expect(html).toContain("Connect this computer");
    expect(html).toContain('id="keys"');
    expect(html).toContain(">Connection keys</h2>");
    expect(html).toContain("Create a connection key");
    expect(html).toContain("What your agents may do on their own");
    expect(html).toContain("Pause for 1 hour");
    expect(html).toContain(">Delete this project</h2>");
    expect(html).not.toMatch(/>[^<]*\b[Tt]okens?\b[^<]*</);
  });

  it("AC-030-03 the old addresses redirect to their new place with a 308", async () => {
    const redirects = await nextConfig.redirects?.();
    expect(redirects).toEqual([
      { source: "/projects/:id/proposals", destination: "/projects/:id/decide", permanent: true },
      { source: "/projects/:id/approvals", destination: "/projects/:id/decide", permanent: true },
      { source: "/projects/:id/plan", destination: "/projects/:id/features#plan", permanent: true },
      { source: "/projects/:id/connect", destination: "/projects/:id/settings", permanent: true },
      // FEAT-039 (AC-039-02): the project's own address opens its Overview.
      { source: "/projects/:id", destination: "/projects/:id/overview", permanent: false },
    ]);
    // Next.js answers permanent redirects with 308, which keeps the method.
    expect(
      redirects?.filter((r) => r.source !== "/projects/:id").every((r) => r.permanent === true),
    ).toBe(true);
  });

  it("AC-030-04 permission: a stranger gets 404 on To decide and Settings, and counts never include another user's data", async () => {
    await agentAsk(world.db, pid, { action: "delete_feature", summary: "Remove the old cart" });
    await attentionReceipt(pid);
    expect(await navCounts(world.db, owner, pid)).toEqual({ receipts: 1, decide: 1 });
    // A stranger's own busy project is never counted in the owner's tabs, and theirs never shows ours.
    const stranger = await world.createUser({ name: "stranger" });
    const theirs = (await projectsRepo.create(world.db, stranger.id, { name: "Theirs" })).id;
    await attentionReceipt(theirs);
    await agentAsk(world.db, theirs, { action: "delete_feature", summary: "Their request" });
    expect(await navCounts(world.db, owner, pid)).toEqual({ receipts: 1, decide: 1 });
    await expect(navCounts(world.db, stranger, pid)).rejects.toMatchObject({ status: 404 });
    world.signInAs(stranger);
    for (const render of [
      () => page(SettingsPage({ params: Promise.resolve({ id: pid }) })),
      () =>
        page(
          DecidePage({ params: Promise.resolve({ id: pid }), searchParams: Promise.resolve({}) }),
        ),
    ]) {
      const err = await render().catch((e: unknown) => e);
      expect(String((err as { digest?: string }).digest ?? err)).toContain("404");
    }
    // The owner's To decide page shows the waiting request.
    world.signInAs(owner);
    const decide = await page(
      DecidePage({ params: Promise.resolve({ id: pid }), searchParams: Promise.resolve({}) }),
    );
    expect(decide).toContain("Remove the old cart");
    expect(decide).not.toContain("Their request");
  });
});
