// 2026-11-02 (owner item 3): an item the owner closes is "Closed by you", never shown as done by the agent. The flag is
// checklist_items.closed_by_owner; a receipt judge never overwrites it; a receipt written before the close shows it too.
// Attacker tests are named "attack: ..."; every other test is a case the owner asked for.
import { POST as closeRoute } from "@/app/api/projects/[id]/checklist-items/[itemId]/close/route";
import { POST as cleanupRoute } from "@/app/api/projects/[id]/open-items/cleanup/route";
import {
  type ChecklistItem,
  checklistItemsRepo,
  projectsRepo,
  receipts,
  requests,
  requestsRepo,
} from "@brain/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth";
import { receiptsFeed } from "./dashboard";
import { type TestWorld, createTestWorld } from "./test-helpers";

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let projectId: string;
let otherProjectId: string;

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  otherProjectId = (await projectsRepo.create(world.db, stranger.id, { name: "other" })).id;
});

afterEach(async () => {
  await world.teardown();
});

// One request with one open item, made at `when`.
async function seed(
  pid: string,
  text: string,
  when = new Date("2026-10-01T10:00:00Z"),
): Promise<ChecklistItem & { requestId: string }> {
  const created = await requestsRepo.createWithItems(
    world.db,
    pid,
    { featureId: null, text: `request: ${text}` },
    [{ text, needsClarification: false }],
  );
  await world.db
    .update(requests)
    .set({ createdAt: when })
    .where(eq(requests.id, created.request.id));
  return { ...(created.items[0] as ChecklistItem), requestId: created.request.id };
}

const closeOf = (pid: string, itemId: string) =>
  closeRoute(
    new Request(`http://x/api/projects/${pid}/checklist-items/${itemId}/close`, { method: "POST" }),
    { params: Promise.resolve({ id: pid, itemId }) },
  );

const cleanupOf = (pid: string) =>
  cleanupRoute(new Request(`http://x/api/projects/${pid}/open-items/cleanup`, { method: "POST" }), {
    params: Promise.resolve({ id: pid }),
  });

describe("closed_by_owner (owner item 3)", () => {
  it("the column exists, is not null and defaults to false", async () => {
    const res = await world.pg.query<{
      is_nullable: string;
      column_default: string | null;
    }>(
      `select is_nullable, column_default from information_schema.columns
       where table_name = 'checklist_items' and column_name = 'closed_by_owner'`,
    );
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.is_nullable).toBe("NO");
    expect(res.rows[0]?.column_default).toContain("false");
  });

  it("the owner's Close marks the item closed by the owner, and it is done", async () => {
    const item = await seed(projectId, "Add a comment at the top of the main page");
    world.signInAs(owner);
    expect((await closeOf(projectId, item.id)).status).toBe(200);
    const row = await checklistItemsRepo.byId(world.db, projectId, item.id);
    expect(row?.status).toBe("done");
    expect(row?.closedByOwner).toBe(true);
  });

  it("a cleanup close is the agent's evidence, not the owner's: closed_by_owner stays false", async () => {
    const t = (d: string) => new Date(`2026-10-0${d}T10:00:00Z`);
    const open = await seed(projectId, "Add a pricing page", t("1"));
    const later = await seed(projectId, "Add a pricing page", t("2"));
    await checklistItemsRepo.setStatuses(world.db, projectId, [{ id: later.id, status: "done" }]);
    world.signInAs(owner);
    expect((await cleanupOf(projectId)).status).toBe(200);
    const row = await checklistItemsRepo.byId(world.db, projectId, open.id);
    expect(row?.status).toBe("done");
    expect(row?.closedByOwner).toBe(false);
  });

  it("attack: an agent receipt never overwrites an item the owner closed", async () => {
    const item = await seed(projectId, "Add a pricing page");
    world.signInAs(owner);
    await closeOf(projectId, item.id);
    await checklistItemsRepo.setStatuses(world.db, projectId, [{ id: item.id, status: "missed" }]);
    await checklistItemsRepo.setStatuses(world.db, projectId, [
      { id: item.id, status: "done_untested" },
    ]);
    const row = await checklistItemsRepo.byId(world.db, projectId, item.id);
    expect(row?.status).toBe("done");
    expect(row?.closedByOwner).toBe(true);
  });

  it("attack: a stranger cannot close an item of someone else's project: 404, and it stays open", async () => {
    const item = await seed(projectId, "Add a pricing page");
    world.signInAs(stranger);
    expect((await closeOf(projectId, item.id)).status).toBe(404);
    const row = await checklistItemsRepo.byId(world.db, projectId, item.id);
    expect(row?.status).toBe("open");
    expect(row?.closedByOwner).toBe(false);
  });

  it("attack: the owner cannot close an item of another project through their own project id", async () => {
    const foreign = await seed(otherProjectId, "Add a pricing page");
    world.signInAs(owner);
    expect((await closeOf(projectId, foreign.id)).status).toBe(404);
    const row = await checklistItemsRepo.byId(world.db, otherProjectId, foreign.id);
    expect(row?.status).toBe("open");
    expect(row?.closedByOwner).toBe(false);
  });

  it("a receipt written before the owner closed the item still shows it as closed by the owner", async () => {
    const item = await seed(projectId, "Add a pricing page");
    // The receipt the agent wrote judged the item missed; the owner closes it afterwards.
    await world.db.insert(receipts).values({
      projectId,
      requestId: item.requestId,
      summaryJson: {
        items: [{ id: item.id, text: item.text, status: "missed", evidence: [] }],
      },
    });
    world.signInAs(owner);
    await closeOf(projectId, item.id);
    const feed = await receiptsFeed(world.db, owner, projectId, 1);
    const shown = feed.rows[0]?.view.items[0];
    expect(shown?.status).toBe("done");
    expect(shown?.closedByOwner).toBe(true);
  });
});
