// The MCP route with an OAuth access token: one token, one project; expiry, revocation and wrong resources are refused.
// The CLI token regression at the end: a CLI project token reads the tools exactly as before.
import { GET as whoami } from "@/app/api/token/whoami/route";
import { POST as mcp } from "@/app/mcp/route";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { featuresRepo, oauthGrants, oauthTokens, projectTokensRepo, projectsRepo } from "@brain/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth";
import { ORIGIN, bearerRequest, connect, exchange, useLocalOrigin } from "./mcp-oauth-test-helpers";

let nextId = 1;
let world: TestWorld;
let owner: SessionUser;
let shopId: string;
let vaultId: string;

useLocalOrigin();

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "Owner" });
  shopId = (await projectsRepo.create(world.db, owner.id, { name: "Shop" })).id;
  const other = await world.createUser({ name: "Other" });
  vaultId = (await projectsRepo.create(world.db, other.id, { name: "Vault" })).id;
  await featuresRepo.insert(world.db, shopId, { name: "Checkout" });
  await featuresRepo.insert(world.db, vaultId, { name: "Secret vault feature" });
});
afterEach(async () => {
  await world.teardown();
});

// Issued at the real time: the route checks expiry against the clock, as it does in production.
async function oauthToken(projectId: string): Promise<string> {
  const c = await connect(world, owner, projectId);
  const r = await exchange(world, { clientId: c.clientId, code: c.code, verifier: c.verifier });
  return (r.body as { access_token: string }).access_token;
}

// One JSON-RPC tools/call to /mcp, as an MCP client sends it.
async function callTool(token: string | null, name: string, args: Record<string, unknown>) {
  const res = await mcp(
    bearerRequest("/mcp", token, {
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  const body = await res.text();
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  const json = JSON.parse(line ? line.slice(6) : body) as {
    result?: { content?: { text: string }[]; isError?: boolean };
  };
  return {
    status: res.status,
    headers: res.headers,
    text: json.result?.content?.[0]?.text ?? body,
    isError: json.result?.isError === true,
  };
}

describe("MCP with an OAuth access token", () => {
  it("reads the tools for the one project the grant was made for", async () => {
    const token = await oauthToken(shopId);
    const res = await callTool(token, "list_features", {});
    expect(res.status).toBe(200);
    expect(res.isError).toBe(false);
    expect(res.text).toContain("Checkout");
    expect(res.text).not.toContain("Secret vault feature");
  });

  it("attack: a token for project A asking for project B gets not_found and none of B's data", async () => {
    const token = await oauthToken(shopId);
    const res = await callTool(token, "list_features", { projectId: vaultId });
    expect(res.isError).toBe(true);
    expect(res.text).not.toContain("Secret vault feature");
    expect(res.text).toContain("-32004");
  });

  it("attack: a token for project A cannot read project B through any tool that takes a feature", async () => {
    const token = await oauthToken(shopId);
    const res = await callTool(token, "get_context_pack", {
      projectId: vaultId,
      feature: "Secret vault feature",
    });
    expect(res.text).not.toContain("Secret vault feature");
    expect(res.isError).toBe(true);
  });

  it("the grant's last used time is recorded when the token reads", async () => {
    const token = await oauthToken(shopId);
    await callTool(token, "list_features", {});
    const [grant] = await world.db.select().from(oauthGrants);
    expect(grant?.lastUsedAt).not.toBeNull();
  });

  it("attack: a missing token gets 401 with the challenge and the sign-in text", async () => {
    const res = await callTool(null, "list_features", {});
    expect(res.status).toBe(401);
    expect(res.text).toContain("npx codeceipt");
  });

  it("attack: an expired access token gets 401", async () => {
    const token = await oauthToken(shopId);
    await world.db
      .update(oauthTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthTokens.kind, "access"));
    const res = await callTool(token, "list_features", {});
    expect(res.status).toBe(401);
  });

  it("attack: a revoked grant's access token gets 401", async () => {
    const token = await oauthToken(shopId);
    await world.db.update(oauthGrants).set({ revokedAt: new Date() });
    const res = await callTool(token, "list_features", {});
    expect(res.status).toBe(401);
  });

  it("attack: a token whose grant was made for another resource gets 401", async () => {
    const token = await oauthToken(shopId);
    await world.db.update(oauthGrants).set({ resource: "https://other.example/mcp" });
    const res = await callTool(token, "list_features", {});
    expect(res.status).toBe(401);
  });

  it("attack: an OAuth access token is not accepted by the CLI's own API routes", async () => {
    const token = await oauthToken(shopId);
    const res = await whoami(
      new Request(`${ORIGIN}/api/token/whoami`, { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(res.status).toBe(401);
  });
});

describe("regression: CLI project tokens", () => {
  it("a CLI project token still reads the MCP tools for its project, as before", async () => {
    const { token } = await projectTokensRepo.create(world.db, shopId);
    const res = await callTool(token, "list_features", {});
    expect(res.status).toBe(200);
    expect(res.isError).toBe(false);
    expect(res.text).toContain("Checkout");
    expect(res.text).not.toContain("Secret vault feature");
  });

  it("a CLI project token still cannot read another project (unchanged)", async () => {
    const { token } = await projectTokensRepo.create(world.db, shopId);
    const res = await callTool(token, "list_features", { projectId: vaultId });
    expect(res.isError).toBe(true);
    expect(res.text).not.toContain("Secret vault feature");
  });

  it("a revoked CLI token is still refused with 401", async () => {
    const { token, row } = await projectTokensRepo.create(world.db, shopId);
    await projectTokensRepo.revoke(world.db, shopId, row.id);
    expect((await callTool(token, "list_features", {})).status).toBe(401);
  });
});
