import ReceiptsPage from "@/app/projects/[id]/receipts/page";
import { dayLabel, matchesSearch, nextIndex } from "@/components/receipts-filter";
import { projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TestWorld, createTestWorld } from "./test-helpers";

// The receipts feed (2026-11-01): find a receipt by what was asked, read it by day, and move with the keyboard
// ("/" search, j/k next and previous, o open), like the best developer dashboards.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

describe("receipts feed helpers", () => {
  const now = new Date("2026-11-01T12:00:00.000Z");
  it("labels days as Today, Yesterday or the date", () => {
    expect(dayLabel("2026-11-01T08:00:00.000Z", now)).toBe("Today");
    expect(dayLabel("2026-10-31T23:59:00.000Z", now)).toBe("Yesterday");
    expect(dayLabel("2026-10-20T10:00:00.000Z", now)).toBe("2026-10-20");
  });
  it("search matches every word, in any order, ignoring case", () => {
    expect(matchesSearch("add star ratings to reviews", "Reviews star")).toBe(true);
    expect(matchesSearch("add star ratings to reviews", "billing")).toBe(false);
    expect(matchesSearch("anything", "   ")).toBe(true);
  });
  it("j/k move within the visible cards and stop at the ends", () => {
    expect(nextIndex(-1, 1, 3)).toBe(0);
    expect(nextIndex(0, 1, 3)).toBe(1);
    expect(nextIndex(2, 1, 3)).toBe(2);
    expect(nextIndex(0, -1, 3)).toBe(0);
    expect(nextIndex(-1, -1, 0)).toBe(-1);
  });
});

describe("receipts feed page", () => {
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

  it("has a labelled search box, the shortcuts, day headings and searchable cards", async () => {
    const { request } = await requestsRepo.createWithItems(
      world.db,
      projectId,
      { featureId: null, text: "Add Star ratings to Reviews" },
      [],
    );
    await receiptsRepo.insert(world.db, projectId, {
      requestId: request.id,
      summaryJson: { items: [] },
    });
    const html = renderToStaticMarkup(
      (await ReceiptsPage({
        params: Promise.resolve({ id: projectId }),
        searchParams: Promise.resolve({}),
      })) as ReactElement,
    );
    expect(html).toMatch(/<input[^>]*type="search"[^>]*aria-label="Search receipts"/);
    expect(html).toContain('data-search="add star ratings to reviews"');
    expect(html).toMatch(/<li class="day-heading"[^>]*><h2[^>]*>Today<\/h2><\/li>/);
    expect(html).toContain("<kbd>/</kbd>");
    expect(html).toContain("<kbd>j</kbd>");
  });
});
