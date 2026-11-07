// Roadmap Phase 3b: plan approval writes the Blueprint, Discover, the safety check, proof from checklist status and
// the owner routes (with their attacks).
import { GET as discoverRoute } from "@/app/api/projects/[id]/blueprint/discover/route";
import { POST as editRoute, GET as viewRoute } from "@/app/api/projects/[id]/blueprint/route";
import { GET as safetyRoute } from "@/app/api/projects/[id]/blueprint/safety/route";
import type { Llm } from "@brain/core";
import {
  blueprintRepo,
  criteriaRepo,
  featureFilesRepo,
  featuresRepo,
  filesRepo,
  planDraftsRepo,
  projectTokensRepo,
  projectsRepo,
} from "@brain/db";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth";
import { blueprintView, editBlueprint } from "./blueprint";
import { setLlmForTests } from "./llm";
import { resetMigrationCheckForTests } from "./migration-check";
import { approvePlan, planProject } from "./plan";
import { type TestWorld, createTestWorld } from "./test-helpers";

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let pid: string;
let tok: { id: string; projectId: string };
let token: string;
const NOW = new Date("2026-11-07T12:00:00Z");

const json = (v: unknown) => JSON.stringify(v);
const items = [
  { text: "WHEN a member books a class, THE SYSTEM SHALL save the booking", kind: "happy" },
  { text: "Booking a full class is refused", kind: "negative" },
  { text: "A member cannot cancel another member's booking", kind: "permission" },
];
function fakeLlm(...answers: string[]) {
  let n = 0;
  setLlmForTests({ complete: async () => answers[n++] ?? "" } satisfies Llm);
}

async function approvedPlan() {
  fakeLlm(
    json({ restated: ["A booking app."], questions: [{ text: "Pay online?", default: "Yes" }] }),
    json({
      features: [
        { name: "Accounts", existing: false, depends_on: [], items },
        { name: "Bookings", existing: false, depends_on: ["Accounts"], items },
      ],
    }),
  );
  const s1 = (await planProject(world.db, tok, { idea: "A booking app" }, NOW)) as {
    plan_id: string;
  };
  await planProject(world.db, tok, { planId: s1.plan_id, approveDefaults: true }, NOW);
  const row = await planDraftsRepo.latest(world.db, pid, "draft");
  if (!row?.draftHash) throw new Error("no draft");
  return approvePlan(world.db, owner, pid, { draftId: row.id, draftHash: row.draftHash }, NOW);
}

const call = (
  route: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  id: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  route(
    new Request(`http://x/api/projects/${id}/blueprint`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(async () => {
  resetMigrationCheckForTests();
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  pid = (await projectsRepo.create(world.db, owner.id, { name: "Studio" })).id;
  const created = await projectTokensRepo.create(world.db, pid);
  token = created.token;
  tok = { id: created.row.id, projectId: pid };
  world.signInAs(owner);
});
afterEach(async () => {
  setLlmForTests(undefined);
  resetMigrationCheckForTests();
  await world.teardown();
});

describe("Phase 3b: plan approval writes the Blueprint", () => {
  it("BP-3B-07 an approved plan is a Blueprint version: criteria linked to its items, kinds from the plan, build order", async () => {
    await approvedPlan();
    expect(await blueprintRepo.currentVersion(world.db, pid)).toBe(1);
    const view = await blueprintView(world.db, owner, pid);
    const bookings = view.features.find((f) => f.name === "Bookings");
    const accounts = view.features.find((f) => f.name === "Accounts");
    const own = view.criteria.filter((c) => c.featureId === bookings?.id);
    expect(own.map((c) => c.kind)).toEqual(["behaviour", "must_never", "security"]);
    expect(own.every((c) => c.checklistItemId !== null && c.createdBy === "owner")).toBe(true);
    expect(view.dependencies).toContainEqual({
      featureId: bookings?.id,
      dependsOnId: accounts?.id,
    });
    expect((await blueprintRepo.getVersion(world.db, pid, 1))?.reason).toBe("plan_approve");
  });

  it("BP-3B-08 a criterion whose checklist item is done is 'done, not proven' until a test proves it", async () => {
    await approvedPlan();
    const [c] = await criteriaRepo.all(world.db, pid);
    expect((await blueprintView(world.db, owner, pid)).proof[c?.id ?? ""]).toBe("not_proven");
    await world.db.execute(
      sql`UPDATE checklist_items SET status = 'done' WHERE id = ${c?.checklistItemId}`,
    );
    expect((await blueprintView(world.db, owner, pid)).proof[c?.id ?? ""]).toBe("done_not_proven");
  });

  it("BP-3B-09 before migration 0054 is applied, plan approval works exactly as before", async () => {
    await world.db.execute(sql`DELETE FROM "_brain_migrations" WHERE id = '0054_blueprint'`);
    resetMigrationCheckForTests();
    const r = await approvedPlan();
    expect(r.feature_ids).toHaveLength(2);
    expect(await criteriaRepo.all(world.db, pid)).toHaveLength(0);
  });
});

describe("Phase 3b: Discover and the safety check", () => {
  it("BP-3B-10 Discover lists features as built and moves on once the owner confirms one", async () => {
    const f = await featuresRepo.insert(world.db, pid, { name: "Orders" });
    const file = await filesRepo.insert(world.db, pid, {
      path: "app/api/orders/route.ts",
      hash: "h",
    });
    await featureFilesRepo.link(world.db, pid, {
      featureId: f.id,
      fileId: file.id,
      role: "primary",
      placedBy: "auto",
    });
    await world.db.execute(
      sql`INSERT INTO symbols (id, project_id, file_id, kind, name, signature) VALUES ('s1', ${pid}, ${file.id}, 'route', '/api/orders', 'route')`,
    );
    const res = await call(discoverRoute, pid);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      next: string;
      features: {
        featureId: string;
        routes: string[];
        suggestions: { text: string; kind: string }[];
      }[];
    };
    expect(body.next).toBe(f.id);
    expect(body.features[0]?.routes).toEqual(["/api/orders"]);
    const s = body.features[0]?.suggestions[0];
    const edit = await call(editRoute, pid, {
      baseVersion: 0,
      ops: [{ op: "addCriterion", featureId: f.id, text: s?.text, kind: s?.kind }],
    });
    expect(edit.status).toBe(200);
    expect(
      ((await (await call(discoverRoute, pid)).json()) as { next: string | null }).next,
    ).toBeNull();
  });

  it("BP-3B-11 the safety check ranks open tables first and offers a fix prompt", async () => {
    await featuresRepo.insert(world.db, pid, { name: "Orders" });
    await world.db.execute(
      sql`INSERT INTO db_tables (id, project_id, path, schema, name, rls_enabled) VALUES ('t1', ${pid}, 'supabase/migrations/1.sql', 'public', 'orders', false)`,
    );
    const res = await call(safetyRoute, pid);
    const body = (await res.json()) as {
      risks: { kind: string; fixPrompt: string }[];
      tablesChecked: number;
    };
    expect(body.risks.map((r) => r.kind)).toEqual(["rls_disabled", "no_must_never"]);
    expect(body.risks[0]?.fixPrompt).toContain("public.orders");
    expect(body.tablesChecked).toBe(1);
  });
});

describe("Phase 3b: owner route attacks", () => {
  it("BP-3B-12 attack: a project token, a stranger and a signed-out caller cannot reach the Blueprint routes", async () => {
    world.signInAs(null);
    for (const r of [viewRoute, discoverRoute, safetyRoute]) {
      expect((await call(r, pid, undefined, { authorization: `Bearer ${token}` })).status).toBe(
        401,
      );
    }
    world.signInAs(stranger);
    for (const r of [viewRoute, discoverRoute, safetyRoute])
      expect((await call(r, pid)).status).toBe(404);
    expect((await call(editRoute, pid, { baseVersion: 0, ops: [] })).status).toBe(404);
  });

  it("BP-3B-13 attack: an oversized or malformed edit is refused and changes nothing", async () => {
    const f = await featuresRepo.insert(world.db, pid, { name: "Orders" });
    const big = JSON.stringify({ baseVersion: 0, ops: [], pad: "x".repeat(70 * 1024) });
    expect((await call(editRoute, pid, big)).status).toBe(400);
    expect(
      (await call(editRoute, pid, { baseVersion: 0, ops: [{ op: "dropTable" }] })).status,
    ).toBe(400);
    await expect(
      editBlueprint(world.db, owner, pid, {
        baseVersion: 0,
        ops: [{ op: "addCriterion", featureId: f.id, text: "", kind: "behaviour" }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await blueprintRepo.currentVersion(world.db, pid)).toBe(0);
  });
});
