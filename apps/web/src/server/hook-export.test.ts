import { GET as blueprintRoute } from "@/app/api/hooks/[projectId]/blueprint/route";
import { POST as importRoute } from "@/app/api/hooks/[projectId]/import/route";
import {
  boundariesRepo,
  criteriaRepo,
  planDraftsRepo,
  projectTokensRepo,
  projectsRepo,
} from "@brain/db";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { resetMigrationCheckForTests } from "./migration-check";
import { approvePlan } from "./plan";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Roadmap Phase 8: the Blueprint read for `codeceipt export`: owner-approved content only, this project only.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
let owner: SessionUser;
let pid: string;
let token: string;
let otherToken: string;

beforeEach(async () => {
  resetMigrationCheckForTests();
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  const stranger = await world.createUser({ name: "stranger" });
  pid = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  const other = (await projectsRepo.create(world.db, stranger.id, { name: "vault" })).id;
  token = (await projectTokensRepo.create(world.db, pid)).token;
  otherToken = (await projectTokensRepo.create(world.db, other)).token;
});
afterEach(async () => {
  resetMigrationCheckForTests();
  await world.teardown();
});

const read = (t = token) =>
  blueprintRoute(
    new Request(`http://localhost/api/hooks/${pid}/blueprint`, {
      headers: { authorization: `Bearer ${t}` },
    }),
    { params: Promise.resolve({ projectId: pid }) },
  );

async function approvedCart() {
  await importRoute(
    new Request(`http://localhost/api/hooks/${pid}/import`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        source: "speckit",
        features: [
          {
            name: "Cart",
            path: "specs/001-cart/spec.md",
            line: 1,
            dependsOn: [],
            items: [{ text: "Users add items", kind: "happy", line: 2 }],
          },
        ],
      }),
    }),
    { params: Promise.resolve({ projectId: pid }) },
  );
  const draft = await planDraftsRepo.latest(world.db, pid, "draft");
  const done = await approvePlan(world.db, owner, pid, {
    draftId: draft?.id ?? "",
    draftHash: draft?.draftHash ?? "",
  });
  return done.feature_ids[0] ?? "";
}

describe("Phase 8: the Blueprint for export", () => {
  it("PH8-26 returns approved features, criteria and boundaries; proposals are never exported", async () => {
    const featureId = await approvedCart();
    await criteriaRepo.insert(world.db, pid, {
      featureId,
      text: "An agent's proposal",
      ears: null,
      kind: "behaviour",
      createdBy: "agent",
      status: "proposal",
    });
    await boundariesRepo.insert(world.db, pid, {
      kind: "protected_path",
      pattern: "supabase/migrations/**",
      note: null,
      createdBy: "agent",
      status: "proposal",
    });
    const res = await read();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ready: boolean;
      features: { name: string; criteria: { text: string }[] }[];
      boundaries: unknown[];
    };
    expect(body.ready).toBe(true);
    expect(body.features.map((f) => f.name)).toEqual(["Cart"]);
    expect(body.features[0]?.criteria.map((c) => c.text)).toEqual([
      "Users add items [from specs/001-cart/spec.md:2]",
    ]);
    expect(body.boundaries).toEqual([]);
  });

  it("PH8-27 attack: another project's token gets 404; before migration 0054 nothing is exported", async () => {
    await approvedCart();
    expect((await read(otherToken)).status).toBe(404);
    await world.db.execute(sql`DELETE FROM "_brain_migrations" WHERE id = '0054_blueprint'`);
    resetMigrationCheckForTests();
    const body = (await (await read()).json()) as { ready: boolean; features: unknown[] };
    expect(body).toMatchObject({ ready: false, features: [] });
  });
});
