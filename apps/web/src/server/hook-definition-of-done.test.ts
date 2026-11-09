import { POST } from "@/app/api/hooks/[projectId]/definition-of-done/route";
import {
  boundariesRepo,
  criteriaRepo,
  featuresRepo,
  projectTokensRepo,
  projectsRepo,
} from "@brain/db";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMigrationCheckForTests } from "./migration-check";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Roadmap Phase 5c: the prompt hook reads the request's definition of done with the project token.
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
  const checkout = await featuresRepo.create(world.db, shop.id, "Checkout");
  const otherCheckout = await featuresRepo.create(world.db, other.id, "Checkout");
  if (!checkout || !otherCheckout) throw new Error("features");
  const criterion = (
    projectId: string,
    featureId: string,
    text: string,
    kind: string,
    status: string,
  ) =>
    criteriaRepo.insert(world.db, projectId, {
      featureId,
      text,
      kind: kind as "behaviour",
      createdBy: status === "active" ? "owner" : "agent",
      status: status as "active",
    });
  await criterion(
    shop.id,
    checkout.id,
    "When a coupon is valid, the total shows the discount",
    "behaviour",
    "active",
  );
  await criterion(shop.id, checkout.id, "Never charge a card twice", "must_never", "active");
  await criterion(shop.id, checkout.id, "PROPOSED by an agent", "behaviour", "proposal");
  await criterion(other.id, otherCheckout.id, "OTHER project rule", "must_never", "active");
  await boundariesRepo.insert(world.db, shop.id, {
    kind: "protected_path",
    pattern: "supabase/migrations/**",
    note: null,
    createdBy: "owner",
    status: "active",
  });
  const token = (await projectTokensRepo.create(world.db, shop.id, "laptop")).token;
  const otherToken = (await projectTokensRepo.create(world.db, other.id, "laptop")).token;
  return { shop, token, otherToken };
}

const call = (projectId: string, token: string | null, body: unknown) =>
  POST(
    new Request(`http://localhost/api/hooks/${projectId}/definition-of-done`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId }) },
  );

describe("Phase 5c: definition of done route", () => {
  it("PH5C-05 a request naming a feature gets its active criteria, rules and protected paths", async () => {
    const f = await fixture();
    const res = await call(f.shop.id, f.token, { request: "Add a coupon field to checkout" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { feature: string; note: string };
    expect(body.feature).toBe("Checkout");
    expect(body.note).toContain("When a coupon is valid, the total shows the discount");
    expect(body.note).toContain("Never charge a card twice");
    expect(body.note).toContain("supabase/migrations/**");
    expect(body.note).not.toContain("PROPOSED");
    expect(body.note).not.toContain("OTHER project");
  });

  it("PH5C-06 attack: another project's token gets 404, no token 401, a bad body 400", async () => {
    const f = await fixture();
    expect((await call(f.shop.id, f.otherToken, { request: "checkout" })).status).toBe(404);
    expect((await call(f.shop.id, null, { request: "checkout" })).status).toBe(401);
    expect((await call(f.shop.id, f.token, { request: "x".repeat(8_001) })).status).toBe(400);
    expect((await call(f.shop.id, f.token, { request: 5 })).status).toBe(400);
  });

  it("PH5C-07 no matching feature, or before migration 0054, is an empty answer", async () => {
    const f = await fixture();
    expect(
      await (await call(f.shop.id, f.token, { request: "make the footer blue" })).json(),
    ).toEqual({
      ok: true,
      feature: null,
      note: null,
    });
    await world.db.execute(sql`DELETE FROM "_brain_migrations" WHERE id = '0054_blueprint'`);
    resetMigrationCheckForTests();
    expect(await (await call(f.shop.id, f.token, { request: "checkout coupons" })).json()).toEqual({
      ok: true,
      feature: null,
      note: null,
    });
  });
});
