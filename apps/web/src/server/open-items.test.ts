import { GET as openItemsRoute } from "@/app/api/hooks/[projectId]/open-items/route";
import {
  checklistItemsRepo,
  featuresRepo,
  projectTokensRepo,
  projectsRepo,
  requestsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TestWorld, createTestWorld } from "./test-helpers";

const get = (projectId: string, token: string) =>
  openItemsRoute(
    new Request(`http://x/api/hooks/${projectId}/open-items`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ projectId }) },
  );

let world: TestWorld;
let a: { id: string; token: string };
let b: { id: string; token: string };

beforeEach(async () => {
  world = await createTestWorld();
  const pa = await projectsRepo.create(world.db, (await world.createUser()).id, { name: "a" });
  const pb = await projectsRepo.create(world.db, (await world.createUser()).id, { name: "b" });
  a = { id: pa.id, token: (await projectTokensRepo.create(world.db, pa.id)).token };
  b = { id: pb.id, token: (await projectTokensRepo.create(world.db, pb.id)).token };
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await world.teardown();
});

describe("FEAT-016 open checklist items for the session-end hook", () => {
  it("AC-016-06 lists the newest requests with items that are neither done nor parked, newest first", async () => {
    const f = await featuresRepo.insert(world.db, a.id, { name: "Reviews", key: "reviews" });
    const old = await requestsRepo.createWithItems(
      world.db,
      a.id,
      { featureId: f.id, text: "Old request" },
      [{ text: "Old item", needsClarification: false }],
    );
    const key = ["sk", "_live_", "aB3dE5gH7j", "aB3dE5gH7j"].join("");
    const fresh = await requestsRepo.createWithItems(
      world.db,
      a.id,
      { featureId: f.id, text: `Add reviews‮ with ${key}` },
      [
        { text: "Show the list", needsClarification: false },
        { text: "Add stars", needsClarification: false },
        { text: "Email the owner", needsClarification: false },
      ],
    );
    const done = await requestsRepo.createWithItems(
      world.db,
      a.id,
      { featureId: f.id, text: "Finished" },
      [{ text: "All done", needsClarification: false }],
    );
    await checklistItemsRepo.setStatuses(world.db, a.id, [
      { id: fresh.items[0]?.id as string, status: "done" },
      { id: fresh.items[1]?.id as string, status: "partial" },
      { id: done.items[0]?.id as string, status: "done" },
    ]);
    const res = await get(a.id, a.token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requests.map((r: { id: string }) => r.id)).toEqual([
      fresh.request.id,
      old.request.id,
    ]);
    expect(
      body.requests[0].items.map((i: { text: string; status: string }) => [i.text, i.status]),
    ).toEqual([
      ["Add stars", "partial"],
      ["Email the owner", "open"],
    ]);
    expect(body.requests[0].text).toBe("Add reviews with sk_l***");
  });

  it("AC-016-06 attack: another project's token gets 404 and no items", async () => {
    const res = await get(a.id, b.token);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("requests");
  });
});
