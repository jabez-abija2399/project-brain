import ReceiptsPage from "@/app/projects/[id]/receipts/page";
import { ReceiptsFilter } from "@/components/receipts-filter";
import { projectsRepo, receiptsRepo } from "@brain/db";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionResolver } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Bright ledger (2026-10-31): the receipts feed filters by "needs attention" without a round trip. Each card says
// whether it needs attention (missed or partly done items, findings, test checks, files outside scope); the chips
// show counts and their pressed state to assistive tech.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
let projectId: string;
beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  setSessionResolver(async () => owner);
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "edutech" })).id;
});
afterEach(async () => {
  setSessionResolver(null);
  await world.teardown();
});

const render = async () =>
  renderToStaticMarkup(
    (await ReceiptsPage({
      params: Promise.resolve({ id: projectId }),
      searchParams: Promise.resolve({}),
    })) as ReactElement,
  );

describe("receipts filter", () => {
  it("cards say whether they need attention, and the chips count them", async () => {
    await receiptsRepo.insert(world.db, projectId, {
      summaryJson: { items: [{ id: "a", text: "List", status: "done", evidence: [] }] },
    });
    await receiptsRepo.insert(world.db, projectId, {
      summaryJson: { items: [{ id: "b", text: "Stars", status: "missed", evidence: [] }] },
    });
    await receiptsRepo.insert(world.db, projectId, {
      summaryJson: { items: [], outside_scope: ["src/billing/Invoice.tsx"] },
    });
    const html = await render();
    expect([...html.matchAll(/data-attention="(true|false)"/g)].map((m) => m[1])).toEqual([
      "true",
      "true",
      "false",
    ]);
    expect(html).toMatch(/aria-pressed="true"[^>]*>All<span[^>]*>3<\/span>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Needs attention<span[^>]*>2<\/span>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>All good<span[^>]*>1<\/span>/);
    expect(html).toContain('data-filter="all"');
  });

  it("the filter group is labelled and starts on All", () => {
    const html = renderToStaticMarkup(
      createElement(ReceiptsFilter, { total: 2, attention: 1 }, createElement("ol")),
    );
    expect(html).toContain('<fieldset aria-label="Filter receipts"');
    expect(html).toContain('data-filter="all"');
  });
});
