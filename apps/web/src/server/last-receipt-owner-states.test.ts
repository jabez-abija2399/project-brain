import { GET } from "@/app/api/hooks/[projectId]/last-receipt/route";
import { closeChecklistItem, dismissChecklistItem } from "@/server/checklist-owner-actions";
import {
  checklistItemsRepo,
  projectTokensRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Known gap of PR #36 (fixed here): the last-receipt endpoint says which of the receipt's items the owner closed or
// dismissed, so `codeceipt last` can label them. Only this project's items count; ids must be plain ids.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

describe("last-receipt: owner-closed and dismissed items", () => {
  let world: TestWorld;
  beforeEach(async () => {
    world = await createTestWorld();
  });
  afterEach(async () => {
    await world.teardown();
  });

  async function fixture() {
    const owner = await world.createUser({ name: "owner" });
    world.signInAs(owner);
    const project = await projectsRepo.create(world.db, owner.id, { name: "A" });
    const { request, items } = await requestsRepo.createWithItems(
      world.db,
      project.id,
      { featureId: null, text: "ask" },
      [
        { text: "Add a comment", needsClarification: false },
        { text: "Remove the banner", needsClarification: false },
        { text: "Fix the footer", needsClarification: false },
      ],
    );
    const [closed, dismissed, open] = items;
    if (!closed || !dismissed || !open) throw new Error("fixture needs three items");
    await closeChecklistItem(world.db, owner, project.id, closed.id);
    await dismissChecklistItem(world.db, owner, project.id, dismissed.id);
    const token = (await projectTokensRepo.create(world.db, project.id, "laptop")).token;
    return { owner, project, request, closed, dismissed, open, token };
  }

  const call = async (projectId: string, token: string) => {
    const res = await GET(
      new Request(`http://localhost/api/hooks/${projectId}/last-receipt`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({ projectId }) },
    );
    return (await res.json()) as { owner_closed_ids?: unknown; dismissed_ids?: unknown };
  };

  it("names the owner-closed and the dismissed items of the latest receipt", async () => {
    const f = await fixture();
    await receiptsRepo.insert(world.db, f.project.id, {
      requestId: f.request.id,
      summaryJson: {
        items: [
          { id: f.closed.id, text: "Add a comment", status: "missed" },
          { id: f.dismissed.id, text: "Remove the banner", status: "missed" },
          { id: f.open.id, text: "Fix the footer", status: "missed" },
        ],
      },
    });
    const body = await call(f.project.id, f.token);
    expect(body.owner_closed_ids).toEqual([f.closed.id]);
    expect(body.dismissed_ids).toEqual([f.dismissed.id]);
  });

  it("attack: an item id of another project in this receipt is never named", async () => {
    const f = await fixture();
    const other = await world.createUser({ name: "other" });
    const otherProject = await projectsRepo.create(world.db, other.id, { name: "B" });
    const { items: otherItems } = await requestsRepo.createWithItems(
      world.db,
      otherProject.id,
      { featureId: null, text: "other ask" },
      [{ text: "Other item", needsClarification: false }],
    );
    const foreign = otherItems[0];
    if (!foreign) throw new Error("fixture needs an item");
    await closeChecklistItem(world.db, other, otherProject.id, foreign.id);
    await receiptsRepo.insert(world.db, f.project.id, {
      requestId: f.request.id,
      summaryJson: { items: [{ id: foreign.id, text: "Other item", status: "missed" }] },
    });
    const body = await call(f.project.id, f.token);
    expect(body.owner_closed_ids).toEqual([]);
    expect(body.dismissed_ids).toEqual([]);
  });

  it("attack: ids that are not plain ids are ignored", async () => {
    const f = await fixture();
    await receiptsRepo.insert(world.db, f.project.id, {
      requestId: f.request.id,
      summaryJson: {
        items: [
          { id: f.closed.id, text: "Add a comment", status: "missed" },
          { id: "../../etc", text: "x", status: "missed" },
          { id: 42, text: "y", status: "missed" },
          { text: "no id", status: "missed" },
        ],
      },
    });
    const body = await call(f.project.id, f.token);
    expect(body.owner_closed_ids).toEqual([f.closed.id]);
    expect(body.dismissed_ids).toEqual([]);
  });

  it("with no receipt, nothing is named", async () => {
    const f = await fixture();
    const body = await call(f.project.id, f.token);
    expect(body.owner_closed_ids).toBeUndefined();
    expect(body.dismissed_ids).toBeUndefined();
  });
});
