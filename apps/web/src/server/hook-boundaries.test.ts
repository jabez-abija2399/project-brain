import { GET } from "@/app/api/hooks/[projectId]/boundaries/route";
import { boundariesRepo, projectTokensRepo, projectsRepo } from "@brain/db";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMigrationCheckForTests } from "./migration-check";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Roadmap Phase 5: the guard reads the Blueprint's active boundaries with the project token.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
beforeEach(async () => {
  resetMigrationCheckForTests();
  world = await createTestWorld();
});
afterEach(async () => {
  resetMigrationCheckForTests();
  await world.teardown();
});

async function fixture() {
  const owner = await world.createUser({ name: "owner" });
  const shop = await projectsRepo.create(world.db, owner.id, { name: "shop" });
  const other = await projectsRepo.create(world.db, owner.id, { name: "other" });
  const add = (projectId: string, pattern: string, status: "active" | "proposal") =>
    boundariesRepo.insert(world.db, projectId, {
      kind: "protected_path",
      pattern,
      note: null,
      createdBy: status === "active" ? "owner" : "agent",
      status,
    });
  await add(shop.id, "supabase/migrations/**", "active");
  await add(shop.id, "src/**", "proposal");
  await add(other.id, "lib/**", "active");
  const token = (await projectTokensRepo.create(world.db, shop.id, "laptop")).token;
  const otherToken = (await projectTokensRepo.create(world.db, other.id, "laptop")).token;
  return { shop, other, token, otherToken };
}

const call = (projectId: string, token: string) =>
  GET(
    new Request(`http://localhost/api/hooks/${projectId}/boundaries`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ projectId }) },
  );

describe("Phase 5: the guard's boundaries", () => {
  it("PH5-09 only this project's active boundaries are returned", async () => {
    const f = await fixture();
    const res = await call(f.shop.id, f.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      ready: true,
      boundaries: [{ kind: "protected_path", pattern: "supabase/migrations/**" }],
    });
  });

  it("PH5-10 attack: another project's token gets 404, a missing token 401", async () => {
    const f = await fixture();
    expect((await call(f.shop.id, f.otherToken)).status).toBe(404);
    const anon = await GET(new Request(`http://localhost/api/hooks/${f.shop.id}/boundaries`), {
      params: Promise.resolve({ projectId: f.shop.id }),
    });
    expect(anon.status).toBe(401);
  });

  it("PH5-11 before migration 0054 the answer says the Blueprint is not ready", async () => {
    const f = await fixture();
    await world.db.execute(sql`DELETE FROM "_brain_migrations" WHERE id = '0054_blueprint'`);
    resetMigrationCheckForTests();
    expect(await (await call(f.shop.id, f.token)).json()).toEqual({
      ok: true,
      ready: false,
      boundaries: [],
    });
  });
});
