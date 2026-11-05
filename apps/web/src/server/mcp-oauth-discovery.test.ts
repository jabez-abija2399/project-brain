// MCP OAuth discovery (RFC 8414 and RFC 9728) and the 401 that tells a client how to connect.
import { GET as authorizationServer } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as protectedResourceMcp } from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { GET as protectedResource } from "@/app/.well-known/oauth-protected-resource/route";
import { POST as mcp } from "@/app/mcp/route";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { oauthTokens, projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, bearerRequest, connect, exchange, useLocalOrigin } from "./mcp-oauth-test-helpers";

// No token presented: the challenge only points at the metadata (RFC 9728). A presented token that is not usable gets
// error="invalid_token" as well (RFC 6750 section 3).
const CHALLENGE = `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`;
const INVALID_CHALLENGE = `Bearer error="invalid_token", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`;

let world: TestWorld;
useLocalOrigin();

beforeEach(async () => {
  world = await createTestWorld();
});
afterEach(async () => {
  await world.teardown();
});

describe("OAuth discovery for MCP clients", () => {
  it("RFC 8414: the authorization server metadata names this server's endpoints and S256 PKCE only", async () => {
    const res = await authorizationServer(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      registration_endpoint: `${ORIGIN}/oauth/register`,
      revocation_endpoint: `${ORIGIN}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("RFC 9728: protected resource metadata names the /mcp resource and the authorization server, at both paths", async () => {
    const root = (await (
      await protectedResource(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`))
    ).json()) as Record<string, unknown>;
    const mcpPath = (await (
      await protectedResourceMcp(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`))
    ).json()) as Record<string, unknown>;
    for (const meta of [root, mcpPath]) {
      expect(meta).toMatchObject({
        resource: `${ORIGIN}/mcp`,
        authorization_servers: [ORIGIN],
        bearer_methods_supported: ["header"],
      });
    }
  });

  it("a request to /mcp with no token gets 401, the challenge header and the text that says what to do", async () => {
    const res = await mcp(bearerRequest("/mcp", null));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
    const body = await res.text();
    expect(body).toContain("npx codeceipt");
    expect(body).toContain("sign in");
  });

  it("a request to /mcp with an unknown token gets the invalid_token challenge and the same text", async () => {
    const res = await mcp(bearerRequest("/mcp", "not-a-real-token"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(INVALID_CHALLENGE);
    const body = await res.text();
    expect(body).toContain("npx codeceipt");
    expect(body).toContain("sign in");
  });

  it('attack: an expired access token gets error="invalid_token" and resource_metadata in the challenge', async () => {
    const owner = await world.createUser({ name: "Owner" });
    const shop = await projectsRepo.create(world.db, owner.id, { name: "Shop" });
    const c = await connect(world, owner, shop.id, { now: new Date() });
    const r = await exchange(world, { clientId: c.clientId, code: c.code, verifier: c.verifier });
    const access = (r.body as { access_token: string }).access_token;
    // The token was issued an hour and a day ago: expired now.
    await world.db.update(oauthTokens).set({ expiresAt: new Date(Date.now() - 86_400_000) });
    const res = await mcp(bearerRequest("/mcp", access));
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`,
    );
  });

  it("attack: a request with no token gets a challenge with no error parameter", async () => {
    const res = await mcp(bearerRequest("/mcp", null));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
    expect(res.headers.get("www-authenticate")).not.toContain("error=");
  });

  it("attack: a forged forwarded host cannot change the origin the challenge and metadata name", async () => {
    process.env.BETTER_AUTH_URL = "https://codeceipt.example";
    const forged = {
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    };
    const res = await mcp(bearerRequest("/mcp", null, { headers: forged } as RequestInit));
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://codeceipt.example/.well-known/oauth-protected-resource"',
    );
    const meta = (await (
      await protectedResource(
        new Request("https://evil.example/.well-known/oauth-protected-resource", {
          headers: forged,
        }),
      )
    ).json()) as Record<string, unknown>;
    expect(meta.resource).toBe("https://codeceipt.example/mcp");
    expect(meta.authorization_servers).toEqual(["https://codeceipt.example"]);
  });
});
