import FeaturesLoading from "@/app/projects/[id]/features/loading";
import FeatureBoardPage from "@/app/projects/[id]/features/page";
import { matchesFeature } from "@/components/features-filter";
import { checklistItemsRepo, featuresRepo, projectsRepo, requestsRepo } from "@brain/db";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TestWorld, createTestWorld } from "./test-helpers";

// The feature board (2026-11-01): a summary over the whole project, progress and the next open item per feature,
// sorting on the server (so pages stay right), and search and chips that filter the rows in place.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
let projectId: string;
beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  world.signInAs(owner);
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "edutech" })).id;
});
afterEach(async () => {
  await world.teardown();
});

const render = async (sort?: string) =>
  renderToStaticMarkup(
    (await FeatureBoardPage({
      params: Promise.resolve({ id: projectId }),
      searchParams: Promise.resolve(sort ? { sort } : {}),
    })) as ReactElement,
  );
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function seed() {
  const reviews = await featuresRepo.insert(world.db, projectId, {
    name: "Reviews",
    key: "reviews",
  });
  await featuresRepo.insert(world.db, projectId, { name: "Billing", key: "billing" });
  const { items } = await requestsRepo.createWithItems(
    world.db,
    projectId,
    { featureId: reviews.id, text: "Add reviews" },
    [
      { text: "Show the reviews list", needsClarification: false },
      { text: "Show the average rating", needsClarification: false },
    ],
  );
  await checklistItemsRepo.setStatuses(world.db, projectId, [
    { id: items[0]?.id as string, status: "done" },
  ]);
}

describe("feature board", () => {
  it("summarizes the project, and each row shows progress and the next open item", async () => {
    await seed();
    const html = await render();
    const t = text(html);
    for (const part of ["2 features", "To do 2", "In progress 0", "Done 0", "With open items 1"]) {
      expect(t).toContain(part);
    }
    expect(t).toContain("1 of 2 done");
    expect(t).toContain("Next: Show the average rating");
    expect(html).toMatch(
      /<progress class="progress" value="1" max="2" aria-label="Reviews: 1 of 2 done"/,
    );
    // Every row carries what the filter reads: name, status, open items.
    expect(html).toContain('data-feature="reviews" data-status="todo" data-open="1"');
    expect(html).toContain('data-feature="billing" data-status="todo" data-open="0"');
    expect(html).toMatch(/<input[^>]*type="search"[^>]*aria-label="Search features"/);
  });

  it("sorts on the server with links that say which order is on", async () => {
    await seed();
    const byName = await render();
    expect(byName.indexOf(">Billing<")).toBeLessThan(byName.indexOf(">Reviews<"));
    expect(byName).toMatch(/<a[^>]*aria-current="true"[^>]*>Name<\/a>/);
    const byOpen = await render("open");
    expect(byOpen.indexOf(">Reviews<")).toBeLessThan(byOpen.indexOf(">Billing<"));
    expect(byOpen).toMatch(/<a[^>]*aria-current="true"[^>]*>Most open<\/a>/);
    expect(byOpen).toContain(`href="/projects/${projectId}/features?sort=recent"`);
  });

  it("attack: an unknown sort is the default order, never an error", async () => {
    await seed();
    for (const bad of ["x' OR 1=1 --", "name; DROP TABLE features", "RECENT", ""]) {
      const html = await render(bad);
      expect(html.indexOf(">Billing<")).toBeLessThan(html.indexOf(">Reviews<"));
    }
  });

  it("search matches every word of the name, any order, ignoring case", () => {
    expect(matchesFeature("reviews summary", "Summary rev")).toBe(true);
    expect(matchesFeature("reviews summary", "billing")).toBe(false);
  });

  it("loading: a table-shaped skeleton announced to screen readers", () => {
    const html = renderToStaticMarkup(createElement(FeaturesLoading));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<span class="lp-visually-hidden">Loading features');
    expect(html.match(/skeleton-row/g)?.length).toBe(6);
  });
});
