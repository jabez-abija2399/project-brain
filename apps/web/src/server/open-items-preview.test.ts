// 2026-11-02 (owner item 2): "Clean up open items" shows what it will close and merge before it runs. The preview is the
// same plan with nothing written: POST /open-items/cleanup with {"dryRun": true}. Owner only; a dry run changes nothing.
// Attacker tests are named "attack: ..."; every other test is a case the owner asked for.
import { POST as cleanupRoute } from "@/app/api/projects/[id]/open-items/cleanup/route";
import { checklistItemsRepo, projectsRepo, requests, requestsRepo } from "@brain/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let projectId: string;

const MAIN = "Add a short comment at the top of the main page";

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
});

afterEach(async () => {
  await world.teardown();
});

// One request with one item, made at `when`, optionally with its item's status set.
async function seed(text: string, when: Date, status?: "done"): Promise<string> {
  const created = await requestsRepo.createWithItems(
    world.db,
    projectId,
    { featureId: null, text: `request: ${text}` },
    [{ text, needsClarification: false }],
  );
  await world.db
    .update(requests)
    .set({ createdAt: when })
    .where(eq(requests.id, created.request.id));
  const id = created.items[0]?.id as string;
  if (status) await checklistItemsRepo.setStatuses(world.db, projectId, [{ id, status }]);
  return id;
}

// The 2026-11-02 shape: an open pricing item a later receipt shows done, and three near-duplicates of the comment.
async function seedMess() {
  const t = (d: string) => new Date(`2026-10-0${d}T10:00:00Z`);
  const pricingOpen = await seed("Add a pricing page", t("1"));
  await seed(MAIN, t("1"));
  await seed("Add a comment to the main page", t("2"));
  await seed("Please add a comment at the top of the main page", t("3"));
  await seed("Add a pricing page", t("4"), "done");
  return { pricingOpen };
}

const cleanup = (pid: string, body?: unknown) =>
  cleanupRoute(
    new Request(`http://x/api/projects/${pid}/open-items/cleanup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: pid }) },
  );

async function snapshot(pid = projectId): Promise<string[]> {
  const rows = await world.pg.query<{ id: string; status: string; closed_by_owner: boolean }>(
    "select id, status, closed_by_owner from checklist_items where project_id = $1 order by id",
    [pid],
  );
  return rows.rows.map((r) => `${r.id}:${r.status}:${r.closed_by_owner}`);
}

describe("clean up open items: the preview (owner item 2)", () => {
  it("the dry run lists what will close and what will merge, with each item's text", async () => {
    await seedMess();
    world.signInAs(owner);
    const res = await cleanup(projectId, { dryRun: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      dryRun: boolean;
      closed: number;
      merged: number;
      changes: { id: string; text: string; kind: string; status: string }[];
    };
    expect(body.dryRun).toBe(true);
    expect(body.closed).toBe(1);
    expect(body.merged).toBe(2);
    const close = body.changes.filter((c) => c.kind === "close");
    const merge = body.changes.filter((c) => c.kind === "merge");
    expect(close.map((c) => [c.text, c.status])).toEqual([["Add a pricing page", "done"]]);
    expect(merge.map((c) => c.text).sort()).toEqual(
      [MAIN, "Add a comment to the main page"].sort(),
    );
  });

  it("the dry run changes nothing: every row keeps its status", async () => {
    await seedMess();
    const before = await snapshot();
    world.signInAs(owner);
    expect((await cleanup(projectId, { dryRun: true })).status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  it("the run does what the preview listed, and a second run changes nothing", async () => {
    await seedMess();
    world.signInAs(owner);
    const preview = (await (await cleanup(projectId, { dryRun: true })).json()) as {
      closed: number;
      merged: number;
    };
    const run = await cleanup(projectId);
    expect(await run.json()).toEqual({ ok: true, closed: preview.closed, merged: preview.merged });
    const after = await snapshot();
    expect((await (await cleanup(projectId)).json()).closed).toBe(0);
    expect(await snapshot()).toEqual(after);
  });

  it("the preview lists at most 200 changes and says how many more there are", async () => {
    const day = new Date("2026-10-01T10:00:00Z");
    for (let i = 0; i < 205; i++) await seed(MAIN, new Date(day.getTime() + i * 1000));
    world.signInAs(owner);
    const body = (await (await cleanup(projectId, { dryRun: true })).json()) as {
      merged: number;
      changes: unknown[];
      truncated: boolean;
    };
    expect(body.merged).toBe(204);
    expect(body.changes).toHaveLength(200);
    expect(body.truncated).toBe(true);
  });

  it("a body that is not {dryRun: true} is refused with 400 and changes nothing", async () => {
    await seedMess();
    const before = await snapshot();
    world.signInAs(owner);
    expect((await cleanup(projectId, { dryRun: "yes" })).status).toBe(400);
    expect((await cleanup(projectId, { dryRun: true, extra: 1 })).status).toBe(400);
    expect(await snapshot()).toEqual(before);
  });

  it("attack: a stranger gets 404 on the preview and nothing changes", async () => {
    await seedMess();
    const before = await snapshot();
    world.signInAs(stranger);
    expect((await cleanup(projectId, { dryRun: true })).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it("attack: anonymous gets 401 on the preview", async () => {
    await seedMess();
    world.signInAs(null);
    expect((await cleanup(projectId, { dryRun: true })).status).toBe(401);
  });
});
