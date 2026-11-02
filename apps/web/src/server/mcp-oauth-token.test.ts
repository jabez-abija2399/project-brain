// The token endpoint (POST /oauth/token) and revocation (POST /oauth/revoke), RFC 6749 / 7009 with PKCE and rotation.
import { createHash } from "node:crypto";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { oauthGrants, oauthTokens, projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth";
import { exchangeToken, revokeToken, verifyOAuthAccessToken } from "./mcp-oauth";
import {
  ORIGIN,
  RESOURCE,
  connect,
  exchange,
  formRequest,
  useLocalOrigin,
} from "./mcp-oauth-test-helpers";

const T0 = new Date("2026-11-02T10:00:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

let world: TestWorld;
let owner: SessionUser;
let shopId: string;

useLocalOrigin();

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "Owner" });
  shopId = (await projectsRepo.create(world.db, owner.id, { name: "Shop" })).id;
});
afterEach(async () => {
  await world.teardown();
});

// The tokens of a fresh connection, read back as the server issued them.
async function fresh(now = T0) {
  const c = await connect(world, owner, shopId, { now });
  const r = await exchange(
    world,
    { clientId: c.clientId, code: c.code, verifier: c.verifier },
    now,
  );
  if (r.status !== 200) throw new Error(`exchange failed: ${JSON.stringify(r.body)}`);
  const body = r.body as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };
  return { ...c, ...body };
}

const refreshWith = (
  refresh: string,
  clientId: string,
  now: Date,
  extra: Record<string, string> = {},
) =>
  exchangeToken(
    world.db,
    formRequest(`${ORIGIN}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: clientId,
      ...extra,
    }),
    now,
  );

describe("POST /oauth/token: authorization code", () => {
  it("exchanges the code for a 1-hour access token and a refresh token, and stores only their hashes", async () => {
    const t = await fresh();
    expect(t.token_type).toBe("Bearer");
    expect(t.expires_in).toBe(3600);
    expect(typeof t.refresh_token).toBe("string");
    const rows = await world.db.select().from(oauthTokens);
    expect(rows.map((r) => r.hash).sort()).toEqual(
      [sha(t.access_token), sha(t.refresh_token)].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain(t.access_token);
    expect(JSON.stringify(rows)).not.toContain(t.refresh_token);
    const expiry = Object.fromEntries(rows.map((r) => [r.kind, r.expiresAt.getTime()]));
    expect(expiry.access).toBeGreaterThan(T0.getTime());
    expect(expiry.access).toBeLessThanOrEqual(T0.getTime() + HOUR + 1000);
    expect(expiry.refresh).toBe(T0.getTime() + 30 * DAY);
  });

  it("attack: a wrong PKCE verifier is refused and does not spend the code; the right verifier still gets a token", async () => {
    const c = await connect(world, owner, shopId, { now: T0 });
    const bad = await exchange(
      world,
      { clientId: c.clientId, code: c.code, verifier: "x".repeat(43) },
      T0,
    );
    expect(bad.status).toBe(400);
    expect((bad.body as { error: string }).error).toBe("invalid_grant");
    const good = await exchange(
      world,
      { clientId: c.clientId, code: c.code, verifier: c.verifier },
      T0,
    );
    expect(good.status).toBe(200);
    const token = (good.body as { access_token: string }).access_token;
    expect(await verifyOAuthAccessToken(world.db, token, RESOURCE, T0)).not.toBeNull();
  });

  it("attack: a wrong client or a wrong redirect address does not spend the code; the right request still gets a token", async () => {
    const c = await connect(world, owner, shopId, { now: T0 });
    const wrongClient = await exchange(
      world,
      { clientId: "someone-else", code: c.code, verifier: c.verifier },
      T0,
    );
    expect(wrongClient.status).toBe(400);
    const wrongRedirect = await exchange(
      world,
      {
        clientId: c.clientId,
        code: c.code,
        verifier: c.verifier,
        redirect: "http://localhost:1/other",
      },
      T0,
    );
    expect(wrongRedirect.status).toBe(400);
    const good = await exchange(
      world,
      { clientId: c.clientId, code: c.code, verifier: c.verifier },
      T0,
    );
    expect(good.status).toBe(200);
  });

  it("attack: a replay of a used code by another client, or with a wrong verifier, does not revoke the grant", async () => {
    const t = await fresh();
    const otherClient = await exchange(
      world,
      { clientId: "someone-else", code: t.code, verifier: t.verifier },
      T0,
    );
    expect(otherClient.status).toBe(400);
    const badVerifier = await exchange(
      world,
      { clientId: t.clientId, code: t.code, verifier: "x".repeat(43) },
      T0,
    );
    expect(badVerifier.status).toBe(400);
    expect(await verifyOAuthAccessToken(world.db, t.access_token, RESOURCE, T0)).not.toBeNull();
  });

  it("attack: a code can be used once; the second use revokes the grant and its first tokens", async () => {
    const t = await fresh();
    const c = { clientId: t.clientId, code: t.code, verifier: t.verifier };
    const reuse = await exchange(world, c, T0);
    expect(reuse.status).toBe(400);
    expect(await verifyOAuthAccessToken(world.db, t.access_token, RESOURCE, T0)).toBeNull();
    const refresh = await refreshWith(t.refresh_token, t.clientId, T0);
    expect(refresh.status).toBe(400);
  });

  it("attack: a code is refused after 60 seconds", async () => {
    const c = await connect(world, owner, shopId, { now: T0 });
    const late = await exchange(
      world,
      { clientId: c.clientId, code: c.code, verifier: c.verifier },
      new Date(T0.getTime() + 61_000),
    );
    expect((late.body as { error: string }).error).toBe("invalid_grant");
  });

  it("attack: the code only works at the redirect URI it was issued for and by the client it was issued to", async () => {
    const c = await connect(world, owner, shopId, { now: T0 });
    const other = await exchange(
      world,
      {
        clientId: c.clientId,
        code: c.code,
        verifier: c.verifier,
        redirect: "http://localhost:1/other",
      },
      T0,
    );
    expect((other.body as { error: string }).error).toBe("invalid_grant");

    const d = await connect(world, owner, shopId, { now: T0 });
    const otherClient = await exchange(
      world,
      { clientId: "someone-else", code: d.code, verifier: d.verifier },
      T0,
    );
    expect((otherClient.body as { error: string }).error).toBe("invalid_grant");
  });

  it("attack: a token request for another resource is refused with invalid_target", async () => {
    const c = await connect(world, owner, shopId, { now: T0 });
    const r = await exchange(
      world,
      {
        clientId: c.clientId,
        code: c.code,
        verifier: c.verifier,
        resource: "https://other.example/mcp",
      },
      T0,
    );
    expect((r.body as { error: string }).error).toBe("invalid_target");
  });

  it("an unknown grant type is refused", async () => {
    const r = await exchangeToken(
      world.db,
      formRequest(`${ORIGIN}/oauth/token`, { grant_type: "password" }),
      T0,
    );
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe("unsupported_grant_type");
  });

  it("a PKCE verifier outside the allowed characters or length is refused as invalid", async () => {
    const c = await connect(world, owner, shopId, { now: T0 });
    const r = await exchange(world, { clientId: c.clientId, code: c.code, verifier: "short" }, T0);
    expect(r.status).toBe(400);
  });
});

describe("POST /oauth/token: refresh rotation", () => {
  it("each refresh returns a new refresh token, and the newest one keeps working through the chain", async () => {
    const t = await fresh();
    const first = await refreshWith(t.refresh_token, t.clientId, new Date(T0.getTime() + HOUR));
    expect(first.status).toBe(200);
    const next = first.body as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(t.refresh_token);
    const again = await refreshWith(next.refresh_token, t.clientId, new Date(T0.getTime() + HOUR));
    expect(again.status).toBe(200);
    expect((again.body as { refresh_token: string }).refresh_token).not.toBe(next.refresh_token);
  });

  it("the old refresh token stops working as soon as it was rotated", async () => {
    const t = await fresh();
    await refreshWith(t.refresh_token, t.clientId, new Date(T0.getTime() + HOUR));
    const old = await refreshWith(t.refresh_token, t.clientId, new Date(T0.getTime() + HOUR));
    expect(old.status).toBe(400);
  });

  it("attack: reusing an old refresh token revokes the whole grant, including the newest tokens", async () => {
    const t = await fresh();
    const later = new Date(T0.getTime() + HOUR);
    const rotated = (await refreshWith(t.refresh_token, t.clientId, later)).body as {
      access_token: string;
      refresh_token: string;
    };
    const reuse = await refreshWith(t.refresh_token, t.clientId, later);
    expect(reuse.status).toBe(400);
    expect(
      await verifyOAuthAccessToken(world.db, rotated.access_token, RESOURCE, later),
    ).toBeNull();
    expect((await refreshWith(rotated.refresh_token, t.clientId, later)).status).toBe(400);
  });

  it("attack: a refresh on a revoked grant is refused and issues no tokens, even when the refresh token itself is still unmarked", async () => {
    const t = await fresh();
    // The state a revoke that races a refresh can leave: the grant is revoked, its tokens are not marked yet.
    await world.db.update(oauthGrants).set({ revokedAt: T0 });
    const before = (await world.db.select().from(oauthTokens)).length;
    const r = await refreshWith(t.refresh_token, t.clientId, new Date(T0.getTime() + HOUR));
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe("invalid_grant");
    expect((await world.db.select().from(oauthTokens)).length).toBe(before);
  });

  it("a revoke that happens first makes the refresh fail, and no new tokens are issued", async () => {
    const t = await fresh();
    await revokeToken(
      world.db,
      formRequest(`${ORIGIN}/oauth/revoke`, { token: t.access_token }),
      T0,
    );
    const before = (await world.db.select().from(oauthTokens)).length;
    const r = await refreshWith(t.refresh_token, t.clientId, new Date(T0.getTime() + HOUR));
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe("invalid_grant");
    expect((await world.db.select().from(oauthTokens)).length).toBe(before);
  });

  it("attack: a refresh token presented by another client is refused and does not revoke the grant", async () => {
    const t = await fresh();
    const wrong = await refreshWith(t.refresh_token, "someone-else", new Date(T0.getTime() + HOUR));
    expect(wrong.status).toBe(400);
    expect(await verifyOAuthAccessToken(world.db, t.access_token, RESOURCE, T0)).not.toBeNull();
    expect(
      (await refreshWith(t.refresh_token, t.clientId, new Date(T0.getTime() + HOUR))).status,
    ).toBe(200);
  });

  it("attack: a refresh token is refused after 30 days", async () => {
    const t = await fresh();
    const r = await refreshWith(
      t.refresh_token,
      t.clientId,
      new Date(T0.getTime() + 30 * DAY + 1000),
    );
    expect(r.status).toBe(400);
  });
});

describe("access tokens", () => {
  it("are accepted for their project until one hour after issue, then refused", async () => {
    const t = await fresh();
    expect(
      await verifyOAuthAccessToken(
        world.db,
        t.access_token,
        RESOURCE,
        new Date(T0.getTime() + HOUR - 1000),
      ),
    ).toMatchObject({ projectId: shopId });
    expect(
      await verifyOAuthAccessToken(
        world.db,
        t.access_token,
        RESOURCE,
        new Date(T0.getTime() + HOUR + 1000),
      ),
    ).toBeNull();
  });

  it("attack: a token for another resource is refused even when valid", async () => {
    const t = await fresh();
    expect(
      await verifyOAuthAccessToken(world.db, t.access_token, "https://other.example/mcp", T0),
    ).toBeNull();
  });

  it("attack: a made-up token, an empty token and a refresh token used as access are all refused", async () => {
    const t = await fresh();
    expect(await verifyOAuthAccessToken(world.db, "made-up", RESOURCE, T0)).toBeNull();
    expect(await verifyOAuthAccessToken(world.db, "", RESOURCE, T0)).toBeNull();
    expect(await verifyOAuthAccessToken(world.db, t.refresh_token, RESOURCE, T0)).toBeNull();
  });
});

describe("POST /oauth/revoke (RFC 7009)", () => {
  it("revoking a token ends its grant at once; the response is 200 either way", async () => {
    const t = await fresh();
    const r = await revokeToken(
      world.db,
      formRequest(`${ORIGIN}/oauth/revoke`, { token: t.refresh_token, client_id: t.clientId }),
      T0,
    );
    expect(r.status).toBe(200);
    expect(await verifyOAuthAccessToken(world.db, t.access_token, RESOURCE, T0)).toBeNull();
    expect((await refreshWith(t.refresh_token, t.clientId, T0)).status).toBe(400);
  });

  it("an unknown token is still answered with 200 (nothing is revealed)", async () => {
    const r = await revokeToken(
      world.db,
      formRequest(`${ORIGIN}/oauth/revoke`, { token: "unknown" }),
      T0,
    );
    expect(r.status).toBe(200);
  });

  it("a request with no token is invalid_request", async () => {
    const r = await revokeToken(world.db, formRequest(`${ORIGIN}/oauth/revoke`, {}), T0);
    expect(r.status).toBe(400);
  });

  it("attack: a revoke naming another client does not end the grant", async () => {
    const t = await fresh();
    await revokeToken(
      world.db,
      formRequest(`${ORIGIN}/oauth/revoke`, { token: t.access_token, client_id: "someone-else" }),
      T0,
    );
    expect(await verifyOAuthAccessToken(world.db, t.access_token, RESOURCE, T0)).not.toBeNull();
  });

  it("the grant is kept with its project and gets a revoked time (nothing is deleted)", async () => {
    const t = await fresh();
    await revokeToken(
      world.db,
      formRequest(`${ORIGIN}/oauth/revoke`, { token: t.access_token }),
      T0,
    );
    const rows = await world.db.select().from(oauthGrants);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ projectId: shopId, userId: owner.id });
    expect(rows[0]?.revokedAt).not.toBeNull();
  });
});
