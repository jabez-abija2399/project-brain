import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { projectTokensRepo, projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as whoami } from "../whoami/route";
import { POST as revoke } from "./route";

let world: TestWorld;
beforeEach(async () => {
  world = await createTestWorld();
});
afterEach(async () => {
  await world.teardown();
});

const call = (handler: (req: Request) => Promise<Response>, token: string, method = "GET") =>
  handler(
    new Request("http://localhost/api/token/x", {
      method,
      headers: { authorization: `Bearer ${token}` },
    }),
  );

describe("POST /api/token/revoke (backlog)", () => {
  it("BL-09 a token revokes itself and only itself; a revoked or missing token is 401", async () => {
    const owner = await world.createUser();
    const p = await projectsRepo.create(world.db, owner.id, { name: "app" });
    const a = await projectTokensRepo.create(world.db, p.id, "old laptop");
    const b = await projectTokensRepo.create(world.db, p.id, "new laptop");
    expect((await call(revoke, a.token, "POST")).status).toBe(200);
    expect((await call(whoami, a.token)).status).toBe(401);
    expect((await call(whoami, b.token)).status).toBe(200);
    expect((await call(revoke, a.token, "POST")).status).toBe(401);
    const none = await revoke(new Request("http://localhost/api/token/revoke", { method: "POST" }));
    expect(none.status).toBe(401);
  });
});
