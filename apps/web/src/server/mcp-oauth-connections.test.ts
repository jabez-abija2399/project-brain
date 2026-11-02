import { createHash } from "node:crypto";
// The account page's list of OAuth connections, and revoking one (DELETE /api/account/oauth-connections/[id]).
import AccountPage from "@/app/account/page";
import { DELETE as revokeConnectionRoute } from "@/app/api/account/oauth-connections/[id]/route";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { oauthTokens, projectsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { connectionsFor, revokeConnection, verifyOAuthAccessToken } from "./mcp-oauth";
import { ORIGIN, RESOURCE, connect, exchange, useLocalOrigin } from "./mcp-oauth-test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const T0 = new Date("2026-11-02T10:00:00Z");
let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let shopId: string;

useLocalOrigin();

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "Owner" });
  stranger = await world.createUser({ name: "Stranger" });
  shopId = (await projectsRepo.create(world.db, owner.id, { name: "Shop" })).id;
});
afterEach(async () => {
  await world.teardown();
});

async function connected() {
  const c = await connect(world, owner, shopId, { now: T0, clientName: "VS Code" });
  const r = await exchange(world, { clientId: c.clientId, code: c.code, verifier: c.verifier }, T0);
  return r.body as { access_token: string; refresh_token: string };
}

describe("the account page: OAuth connections", () => {
  it("lists each connection with the client name, the project name, when it was made and last used", async () => {
    await connected();
    const list = await connectionsFor(world.db, owner);
    expect(list).toHaveLength(1);
    // The row's own creation time (the database sets it), in ISO form.
    expect(list[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(list[0]).toMatchObject({
      clientName: "VS Code",
      projectName: "Shop",
      lastUsedAt: null,
      revokedAt: null,
    });
  });

  it("the page shows the connection, and never a token or a hash", async () => {
    const tokens = await connected();
    world.signInAs(owner);
    const html = renderToStaticMarkup((await AccountPage()) as ReactElement);
    expect(html).toContain("Connected apps");
    expect(html).toContain("VS Code");
    expect(html).toContain("Shop");
    expect(html).not.toContain(tokens.access_token);
    expect(html).not.toContain(createHash("sha256").update(tokens.access_token).digest("hex"));
  });

  it("attack: another user's connections never appear on this user's page or list", async () => {
    await connected();
    expect(await connectionsFor(world.db, stranger)).toEqual([]);
    world.signInAs(stranger);
    const html = renderToStaticMarkup((await AccountPage()) as ReactElement);
    // The empty state names example apps; what must not appear is a row for the owner's connection.
    expect(html).toContain("No apps connected");
    expect(html).not.toContain("data-connection=");
  });
});

describe("revoking a connection", () => {
  it("the owner's Revoke ends the grant's access and refresh tokens at once", async () => {
    const tokens = await connected();
    const [grant] = await connectionsFor(world.db, owner);
    world.signInAs(owner);
    const req = new Request(`${ORIGIN}/api/account/oauth-connections/${grant?.id}`, {
      method: "DELETE",
      headers: { origin: ORIGIN },
    });
    const res = await revokeConnectionRoute(req, {
      params: Promise.resolve({ id: grant?.id ?? "" }),
    });
    expect(res.status).toBe(200);
    expect(await verifyOAuthAccessToken(world.db, tokens.access_token, RESOURCE, T0)).toBeNull();
    const rows = await world.db.select().from(oauthTokens);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect((await connectionsFor(world.db, owner))[0]?.revokedAt).not.toBeNull();
  });

  it("attack: another user cannot revoke this connection (404), and the tokens keep working", async () => {
    const tokens = await connected();
    const [grant] = await connectionsFor(world.db, owner);
    world.signInAs(stranger);
    await expect(
      revokeConnection(
        world.db,
        new Request(`${ORIGIN}/x`, { method: "DELETE", headers: { origin: ORIGIN } }),
        grant?.id ?? "",
        T0,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await verifyOAuthAccessToken(world.db, tokens.access_token, RESOURCE, T0),
    ).not.toBeNull();
  });

  it("attack: a signed-out revoke is 401, and a revoke from another site is 403", async () => {
    await connected();
    const [grant] = await connectionsFor(world.db, owner);
    world.signInAs(null);
    const anon = await revokeConnectionRoute(
      new Request(`${ORIGIN}/api/account/oauth-connections/x`, {
        method: "DELETE",
        headers: { origin: ORIGIN },
      }),
      { params: Promise.resolve({ id: grant?.id ?? "" }) },
    );
    expect(anon.status).toBe(401);
    world.signInAs(owner);
    const foreign = await revokeConnectionRoute(
      new Request(`${ORIGIN}/api/account/oauth-connections/x`, {
        method: "DELETE",
        headers: { origin: "https://evil.example" },
      }),
      { params: Promise.resolve({ id: grant?.id ?? "" }) },
    );
    expect(foreign.status).toBe(403);
  });

  it("attack: an id that is not a connection is 404 for everyone", async () => {
    await connected();
    world.signInAs(owner);
    const res = await revokeConnectionRoute(
      new Request(`${ORIGIN}/api/account/oauth-connections/nope`, {
        method: "DELETE",
        headers: { origin: ORIGIN },
      }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(res.status).toBe(404);
  });
});
