import { PATCH } from "@/app/api/projects/[id]/checklist-items/[itemId]/route";
import { checklistItems, checklistItemsRepo, projectsRepo, requestsRepo } from "@brain/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Round 2 security review (fresh-context reviewer, 2026-11-02): the cross-project move and the capped PATCH body.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

describe("round 2 security", () => {
  let world: TestWorld;
  beforeEach(async () => {
    world = await createTestWorld();
  });
  afterEach(async () => {
    await world.teardown();
  });

  it("attack: an item cannot be moved onto a request of another project", async () => {
    const owner = await world.createUser({ name: "owner" });
    world.signInAs(owner);
    const a = await projectsRepo.create(world.db, owner.id, { name: "A" });
    const b = await projectsRepo.create(world.db, owner.id, { name: "B" });
    const { request: requestA, items } = await requestsRepo.createWithItems(
      world.db,
      a.id,
      { featureId: null, text: "first ask" },
      [{ text: "Add a comment", needsClarification: false }],
    );
    const { request: requestB } = await requestsRepo.createWithItems(
      world.db,
      b.id,
      { featureId: null, text: "other ask" },
      [],
    );
    const item = items[0];
    if (!item) throw new Error("the fixture needs an item");

    const moved = await checklistItemsRepo.moveToRequest(world.db, a.id, requestB.id, [
      { id: item.id, position: 0 },
    ]);

    expect(moved).toBe(0);
    const [row] = await world.db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.id, item.id));
    expect(row?.requestId).toBe(requestA.id);
  });

  it("attack: a PATCH body over the cap is refused (400, as on the other routes) with no Content-Length header and nothing is changed", async () => {
    const owner = await world.createUser({ name: "owner" });
    world.signInAs(owner);
    const project = await projectsRepo.create(world.db, owner.id, { name: "A" });
    const { items } = await requestsRepo.createWithItems(
      world.db,
      project.id,
      { featureId: null, text: "ask" },
      [{ text: "Add a comment", needsClarification: false }],
    );
    const item = items[0];
    if (!item) throw new Error("the fixture needs an item");

    // A streamed body has no Content-Length, so only the capped reader can refuse it.
    const body = JSON.stringify({ dismiss: true, pad: "x".repeat(40_000) });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const req = new Request(
      `http://localhost/api/projects/${project.id}/checklist-items/${item.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit,
    );

    const res = await PATCH(req, {
      params: Promise.resolve({ id: project.id, itemId: item.id }),
    });

    expect(res.status).toBe(400);
    const [row] = await world.db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.id, item.id));
    expect(row?.status).not.toBe("dismissed");
  });
});
