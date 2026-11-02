// Dynamic client registration (RFC 7591): POST /oauth/register.
import { POST as register } from "@/app/oauth/register/route";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { oauthRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_OAUTH_CLIENTS, registerClient } from "./mcp-oauth";
import { jsonRequest, useLocalOrigin } from "./mcp-oauth-test-helpers";

const URL_ = "http://localhost/oauth/register";
const ok = (redirect: string) => ({ client_name: "Client", redirect_uris: [redirect] });

let world: TestWorld;
useLocalOrigin();

beforeEach(async () => {
  world = await createTestWorld();
});
afterEach(async () => {
  await world.teardown();
});

async function post(body: unknown, ip = "203.0.113.7") {
  return register(jsonRequest(URL_, body, { "x-forwarded-for": ip }));
}

describe("POST /oauth/register", () => {
  it("registers a public client (no secret) and answers 201 with the client id", async () => {
    const res = await post({
      client_name: "Claude Desktop",
      redirect_uris: ["http://localhost:33418/callback"],
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.client_id).toBe("string");
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body).not.toHaveProperty("client_secret");
    expect(body.redirect_uris).toEqual(["http://localhost:33418/callback"]);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("accepts https redirect URIs and loopback http on localhost, 127.0.0.1 and [::1]", async () => {
    for (const uri of [
      "https://claude.ai/api/mcp/auth_callback",
      "http://localhost:9000/cb",
      "http://127.0.0.1:9000/cb",
      "http://[::1]:9000/cb",
    ]) {
      expect((await post(ok(uri))).status, uri).toBe(201);
    }
  });

  it("attack: a plain http redirect to another host, or a look-alike of localhost, is refused", async () => {
    for (const uri of [
      "http://evil.example/cb",
      "http://localhost.evil.example/cb",
      "http://127.0.0.2/cb",
      "http://127.0.0.1.evil.example/cb",
      "http://[::ffff:127.0.0.1]/cb",
    ]) {
      const res = await post({ client_name: "x", redirect_uris: [uri] });
      expect(res.status, uri).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("invalid_redirect_uri");
    }
  });

  it("attack: scheme tricks, fragments and embedded credentials are refused", async () => {
    for (const uri of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "file:///etc/passwd",
      "https://claude.ai/cb#token",
      "https://user:pw@claude.ai/cb",
      "https://a@evil.example/cb",
      "https://claude.ai/cb\u0000x",
    ]) {
      const res = await post({ client_name: "x", redirect_uris: [uri] });
      expect(res.status, uri).toBe(400);
    }
  });

  it("attack: a bidirectional control character in the client name is removed before anyone sees it", async () => {
    const res = await post({
      client_name: "Claude\u202eDesktop\u200f",
      redirect_uris: ["https://claude.ai/cb"],
    });
    const body = (await res.json()) as { client_name: string };
    expect(body.client_name).toBe("ClaudeDesktop");
    const stored = await oauthRepo.getClient(
      world.db,
      (body as unknown as { client_id: string }).client_id,
    );
    expect(stored?.name).toBe("ClaudeDesktop");
  });

  it("attack: an oversized body is refused with 413 and nothing is stored", async () => {
    const res = await post({
      client_name: "x".repeat(9000),
      redirect_uris: ["https://claude.ai/cb"],
    });
    expect(res.status).toBe(413);
  });

  it("refuses a client that asks for a client secret, or no redirect URI", async () => {
    const secret = await post({
      client_name: "x",
      redirect_uris: ["https://claude.ai/cb"],
      token_endpoint_auth_method: "client_secret_basic",
    });
    expect(secret.status).toBe(400);
    const none = await post({ client_name: "x" });
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: string }).error).toBe("invalid_client_metadata");
  });

  it("attack: more than 10 redirect URIs is refused (a cap on the list)", async () => {
    const uris = Array.from({ length: 11 }, (_, i) => `https://claude.ai/cb${i}`);
    expect((await post({ client_name: "x", redirect_uris: uris })).status).toBe(400);
  });

  it("attack: registrations are rate limited per address; another address is not", async () => {
    const now = new Date("2026-11-02T10:00:30Z");
    const req = () =>
      jsonRequest(URL_, ok("https://claude.ai/cb"), { "x-forwarded-for": "198.51.100.9" });
    for (let i = 0; i < 10; i++) {
      expect((await registerClient(world.db, req(), now)).status).toBe(201);
    }
    await expect(registerClient(world.db, req(), now)).rejects.toMatchObject({ status: 429 });
    const other = jsonRequest(URL_, ok("https://claude.ai/cb"), {
      "x-forwarded-for": "198.51.100.10",
    });
    expect((await registerClient(world.db, other, now)).status).toBe(201);
  });

  it("attack: with the client cap reached, registration is refused with 503 and nothing is inserted", async () => {
    const now = new Date("2026-11-02T10:00:30Z");
    const req = (ip: string) =>
      jsonRequest(URL_, ok("https://claude.ai/cb"), { "x-forwarded-for": ip });
    const cap = { maxClients: 2 };
    expect((await registerClient(world.db, req("198.51.100.20"), now, cap)).status).toBe(201);
    expect((await registerClient(world.db, req("198.51.100.21"), now, cap)).status).toBe(201);
    const refused = await registerClient(world.db, req("198.51.100.22"), now, cap);
    expect(refused.status).toBe(503);
    expect((refused.body as { error: string }).error).toBe("temporarily_unavailable");
    expect(await oauthRepo.countClients(world.db)).toBe(2);
  });

  it("the global cap on registered clients is 10,000", () => {
    expect(MAX_OAUTH_CLIENTS).toBe(10_000);
  });
});
