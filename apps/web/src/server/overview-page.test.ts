import Loading from "@/app/projects/[id]/loading";
import OverviewPage from "@/app/projects/[id]/overview/page";
import ReceiptsLoading from "@/app/projects/[id]/receipts/loading";
import {
  checklistItemsRepo,
  featuresRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
} from "@brain/db";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TestWorld, createTestWorld } from "./test-helpers";

// The project overview (2026-11-01): the dashboard's front door. It leads with what needs attention, shows the week
// at a glance (attention first), a 14-day activity chart and per-feature progress, each with a next step.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
let projectId: string;
let owner: Awaited<ReturnType<TestWorld["createUser"]>>;

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  world.signInAs(owner);
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "edutech" })).id;
});
afterEach(async () => {
  await world.teardown();
});

const render = async (id = projectId) =>
  renderToStaticMarkup((await OverviewPage({ params: Promise.resolve({ id }) })) as ReactElement);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function seed() {
  const reviews = await featuresRepo.insert(world.db, projectId, {
    name: "Reviews",
    key: "reviews",
  });
  const { request, items } = await requestsRepo.createWithItems(
    world.db,
    projectId,
    { featureId: reviews.id, text: "Add reviews with stars" },
    [
      { text: "Show the reviews list", needsClarification: false },
      { text: "Add a star rating", needsClarification: false },
    ],
  );
  await checklistItemsRepo.setStatuses(world.db, projectId, [
    { id: items[0]?.id as string, status: "done" },
    { id: items[1]?.id as string, status: "missed" },
  ]);
  await receiptsRepo.insert(world.db, projectId, {
    requestId: request.id,
    summaryJson: {
      items: [{ id: "a", text: "Show the reviews list", status: "done", evidence: [] }],
    },
  });
  const bad = await receiptsRepo.insert(world.db, projectId, {
    requestId: request.id,
    summaryJson: {
      items: [{ id: "b", text: "Add a star rating", status: "missed", evidence: [] }],
      findings: [{ type: "stripe_secret_key", file: "src/pay.ts", line: 3, hint: "Move it" }],
    },
  });
  return { bad };
}

describe("project overview", () => {
  it("leads with what needs attention, then the week, the chart, the attention list and feature progress", async () => {
    const { bad } = await seed();
    const html = await render();
    const t = text(html);
    expect(html).toContain('aria-current="page"');
    expect(t).toContain("1 receipt needs your attention");
    // Stat cards, most important first, each with a next step.
    const stats = [...html.matchAll(/data-stat="([\w-]+)"/g)].map((m) => m[1]);
    expect(stats).toEqual(["attention", "missed", "done-rate", "findings"]);
    expect(t).toContain("Needs attention 1");
    expect(t).toContain("Open missed items 1");
    expect(t).toContain("Done this week 50%");
    expect(t).toContain("Security findings 1");
    // 14 days, each bar labelled for screen readers.
    expect(html.match(/data-day="\d{4}-\d{2}-\d{2}"/g)).toHaveLength(14);
    expect(html).toMatch(/aria-label="\d{4}-\d{2}-\d{2}: 1 all good, 1 needs attention"/);
    // The attention list links to the receipt and says why.
    expect(html).toContain(`href="/projects/${projectId}/receipts#receipt-${bad.id}"`);
    expect(t).toContain("1 security finding");
    expect(t).toContain("1 missed");
    // Feature progress.
    expect(t).toContain("Reviews");
    expect(t).toContain("1 of 2 done");
    expect(html).toMatch(
      /<progress class="progress" value="1" max="2" aria-label="Reviews: 1 of 2 done"/,
    );
  });

  it("a new project says what to do next, and never shows a made-up done rate", async () => {
    const t = text(await render());
    expect(t).toContain("No receipts yet");
    expect(t).toContain("Done this week —");
    expect(await render()).toContain(`href="/projects/${projectId}/connect"`);
  });

  it("attack: another user's project is the 404 page, never its numbers", async () => {
    await seed();
    const stranger = await world.createUser({ name: "stranger" });
    world.signInAs(stranger);
    const err = await render().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
  });
});

describe("loading states", () => {
  it("project pages show a skeleton shaped like the page, announced to screen readers", () => {
    for (const L of [Loading, ReceiptsLoading]) {
      const html = renderToStaticMarkup(createElement(L));
      expect(html).toContain('aria-busy="true"');
      expect(html).toMatch(/class="skeleton[^"]*"/);
      expect(html).toContain('<span class="lp-visually-hidden">Loading');
    }
    expect(
      renderToStaticMarkup(createElement(ReceiptsLoading)).match(/skeleton-card/g)?.length,
    ).toBe(3);
  });
});
