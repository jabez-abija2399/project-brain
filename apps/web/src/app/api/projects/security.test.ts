// FEAT-003 security pass: executable attacker tests beyond the AC set.
// Each test models one abuse case; a failing test is a vulnerability.
import {
  DELETE as deleteProject,
  GET as getProject,
  PATCH as patchProject,
} from "@/app/api/projects/[id]/route";
import { DELETE as revokeToken } from "@/app/api/projects/[id]/tokens/[tokenId]/route";
import { POST as createToken, GET as listTokens } from "@/app/api/projects/[id]/tokens/route";
import { POST as createProject, GET as listProjects } from "@/app/api/projects/route";
import { GET as whoami } from "@/app/api/token/whoami/route";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const JSON_HEADERS = { "content-type": "application/json" };

function req(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}
function json(url: string, method: string, body: unknown, extra: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { ...JSON_HEADERS, ...extra },
    body: JSON.stringify(body),
  });
}
function paramsOf<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}

describe("FEAT-003 security pass: attacker tests", () => {
  let world: TestWorld;
  beforeEach(async () => {
    world = await createTestWorld();
  });
  afterEach(async () => {
    await world.teardown();
  });

  async function newOwnedProject(name = "A-only") {
    const alice = await world.createUser({ name: "Alice" });
    world.signInAs(alice);
    const r = await createProject(json("http://x/api/projects", "POST", { name }));
    const body = (await r.json()) as { project: { id: string } };
    return { alice, projectId: body.project.id };
  }

  it("AC-003-08 IDOR POST /api/projects/[id]/tokens: user B creating a token on A's project returns 404", async () => {
    const { projectId } = await newOwnedProject();
    const bob = await world.createUser({ name: "Bob" });
    world.signInAs(bob);

    const res = await createToken(
      json(`http://x/api/projects/${projectId}/tokens`, "POST", {}),
      paramsOf({ id: projectId }),
    );
    expect(res.status).toBe(404);

    const tokens = await world.pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM project_tokens WHERE project_id = $1",
      [projectId],
    );
    expect(tokens.rows[0]?.n).toBe(0);
  });

  it("AC-003-08 IDOR GET /api/projects/[id]/tokens: user B listing A's tokens returns 404 (not an empty list)", async () => {
    const { alice, projectId } = await newOwnedProject();
    world.signInAs(alice);
    await createToken(
      json(`http://x/api/projects/${projectId}/tokens`, "POST", {}),
      paramsOf({ id: projectId }),
    );
    const bob = await world.createUser({ name: "Bob" });
    world.signInAs(bob);

    const res = await listTokens(
      req(`http://x/api/projects/${projectId}/tokens`),
      paramsOf({ id: projectId }),
    );
    expect(res.status).toBe(404);
  });

  it("AC-003-08 IDOR DELETE /api/projects/[id]/tokens/[tokenId]: user B cannot revoke A's token; A's token still works", async () => {
    const { alice, projectId } = await newOwnedProject();
    world.signInAs(alice);
    const createdRes = await createToken(
      json(`http://x/api/projects/${projectId}/tokens`, "POST", {}),
      paramsOf({ id: projectId }),
    );
    const { token, id: tokenId } = (await createdRes.json()) as {
      token: string;
      id: string;
    };

    const bob = await world.createUser({ name: "Bob" });
    world.signInAs(bob);
    const res = await revokeToken(
      req(`http://x/api/projects/${projectId}/tokens/${tokenId}`, { method: "DELETE" }),
      paramsOf({ id: projectId, tokenId }),
    );
    expect(res.status).toBe(404);

    // Token must still authenticate against whoami.
    const check = await whoami(
      req("http://x/api/token/whoami", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(check.status).toBe(200);
    const body = (await check.json()) as { project_id: string };
    expect(body.project_id).toBe(projectId);
  });

  it("IDOR DELETE /api/projects/[id]: user B deleting A's project returns 404 and the project row survives", async () => {
    const { projectId } = await newOwnedProject();
    const bob = await world.createUser({ name: "Bob" });
    world.signInAs(bob);

    const res = await deleteProject(
      req(`http://x/api/projects/${projectId}`, { method: "DELETE" }),
      paramsOf({ id: projectId }),
    );
    expect(res.status).toBe(404);

    const row = await world.pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM projects WHERE id = $1",
      [projectId],
    );
    expect(row.rows[0]?.n).toBe(1);
  });

  it("AC-003-09 mass-assignment on POST /api/projects: owner_id in body is ignored; project is always owned by the caller", async () => {
    const alice = await world.createUser({ name: "Alice" });
    const bob = await world.createUser({ name: "Bob" });
    world.signInAs(bob);
    const res = await createProject(
      json("http://x/api/projects", "POST", {
        name: "trojan",
        ownerId: alice.id,
        owner_id: alice.id,
        id: "attacker-chosen-id",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { project: { id: string; ownerId: string } };
    expect(body.project.ownerId).toBe(bob.id);
    expect(body.project.id).not.toBe("attacker-chosen-id");

    // Alice must NOT see Bob's project in her list.
    world.signInAs(alice);
    const aliceList = await listProjects(req("http://x/api/projects"));
    const aliceBody = (await aliceList.json()) as { projects: Array<{ name: string }> };
    expect(aliceBody.projects.map((p) => p.name)).not.toContain("trojan");
  });

  it("AC-003-10 mass-assignment on PATCH /api/projects/[id]: a strict schema rejects unknown fields with 400", async () => {
    const { alice, projectId } = await newOwnedProject("original");
    world.signInAs(alice);
    const res = await patchProject(
      new Request(`http://x/api/projects/${projectId}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "renamed", ownerId: "hijack" }),
      }),
      paramsOf({ id: projectId }),
    );
    expect(res.status).toBe(400);

    // The project name must not have changed.
    const row = await world.pg.query<{ name: string; owner_id: string }>(
      "SELECT name, owner_id FROM projects WHERE id = $1",
      [projectId],
    );
    expect(row.rows[0]?.name).toBe("original");
    expect(row.rows[0]?.owner_id).toBe(alice.id);
  });

  it("GET /api/projects/[id]/tokens never includes the hash column in the response payload", async () => {
    const { alice, projectId } = await newOwnedProject();
    world.signInAs(alice);
    await createToken(
      json(`http://x/api/projects/${projectId}/tokens`, "POST", {}),
      paramsOf({ id: projectId }),
    );
    const res = await listTokens(
      req(`http://x/api/projects/${projectId}/tokens`),
      paramsOf({ id: projectId }),
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/"hash"/);
    expect(text).not.toMatch(/[0-9a-f]{64}/);
  });

  it("whoami: missing, malformed, and random-looking bearer tokens all return 401 (never 500)", async () => {
    const cases: Record<string, string> = {
      missing: "",
      lowercase: "bearer abc",
      noScheme: "pb_whatever",
      wrongScheme: "Basic Zm9vOmJhcg==",
      randomPrefix: "Bearer pb_this_is_not_a_real_token",
    };
    for (const [label, authHeader] of Object.entries(cases)) {
      const headers: Record<string, string> = {};
      if (authHeader) headers.authorization = authHeader;
      const res = await whoami(req("http://x/api/token/whoami", { headers }));
      expect(res.status, `case: ${label}`).toBe(401);
    }
  });

  it("whoami: a token for project A returns A's id, not any other project id the attacker guesses", async () => {
    const { alice, projectId: aId } = await newOwnedProject("A");
    world.signInAs(alice);
    const aTokRes = await createToken(
      json(`http://x/api/projects/${aId}/tokens`, "POST", {}),
      paramsOf({ id: aId }),
    );
    const { token: aToken } = (await aTokRes.json()) as { token: string };

    const bob = await world.createUser({ name: "Bob" });
    world.signInAs(bob);
    const bRes = await createProject(json("http://x/api/projects", "POST", { name: "B" }));
    const bBody = (await bRes.json()) as { project: { id: string } };

    const res = await whoami(
      req("http://x/api/token/whoami", {
        headers: { authorization: `Bearer ${aToken}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project_id: string };
    expect(body.project_id).toBe(aId);
    expect(body.project_id).not.toBe(bBody.project.id);
  });

  it("DELETE /api/projects/[id]/tokens/[tokenId] on a non-existent tokenId returns 404 (not 500)", async () => {
    const { alice, projectId } = await newOwnedProject();
    world.signInAs(alice);
    const res = await revokeToken(
      req(`http://x/api/projects/${projectId}/tokens/does-not-exist`, { method: "DELETE" }),
      paramsOf({ id: projectId, tokenId: "does-not-exist" }),
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/projects/[id] on an id that does not exist for anyone returns 404 (parity with the IDOR case)", async () => {
    const alice = await world.createUser({ name: "Alice" });
    world.signInAs(alice);
    const res = await getProject(
      req("http://x/api/projects/00000000-0000-0000-0000-000000000000"),
      paramsOf({ id: "00000000-0000-0000-0000-000000000000" }),
    );
    expect(res.status).toBe(404);
  });

  // Round 2: what would the attacker try next?

  it("AC-003-11 deleting a project cascades to its tokens; the plaintext stops authenticating", async () => {
    const { alice, projectId } = await newOwnedProject("doomed");
    world.signInAs(alice);
    const createdRes = await createToken(
      json(`http://x/api/projects/${projectId}/tokens`, "POST", {}),
      paramsOf({ id: projectId }),
    );
    const { token } = (await createdRes.json()) as { token: string };

    const delRes = await deleteProject(
      req(`http://x/api/projects/${projectId}`, { method: "DELETE" }),
      paramsOf({ id: projectId }),
    );
    expect(delRes.status).toBe(200);

    const res = await whoami(
      req("http://x/api/token/whoami", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("AC-003-12 all tokens routes require a session (unauthed POST/GET/DELETE return 401)", async () => {
    const { projectId } = await newOwnedProject();
    world.signInAs(null);
    const postRes = await createToken(
      json(`http://x/api/projects/${projectId}/tokens`, "POST", {}),
      paramsOf({ id: projectId }),
    );
    expect(postRes.status).toBe(401);
    const getRes = await listTokens(
      req(`http://x/api/projects/${projectId}/tokens`),
      paramsOf({ id: projectId }),
    );
    expect(getRes.status).toBe(401);
    const delRes = await revokeToken(
      req(`http://x/api/projects/${projectId}/tokens/anything`, { method: "DELETE" }),
      paramsOf({ id: projectId, tokenId: "anything" }),
    );
    expect(delRes.status).toBe(401);
  });

  it("round 2: a bearer value with trailing whitespace or a tampered byte does not authenticate", async () => {
    const { alice, projectId } = await newOwnedProject();
    world.signInAs(alice);
    const createdRes = await createToken(
      json(`http://x/api/projects/${projectId}/tokens`, "POST", {}),
      paramsOf({ id: projectId }),
    );
    const { token } = (await createdRes.json()) as { token: string };

    // Internal whitespace between prefix and body shifts the hash → 401.
    const tampered = `${token.slice(0, 3)} ${token.slice(3)}`;
    const t1 = await whoami(
      req("http://x/api/token/whoami", {
        headers: { authorization: `Bearer ${tampered}` },
      }),
    );
    expect(t1.status).toBe(401);

    // Flipping the last character of a real token must not authenticate.
    const last = token.at(-1) === "a" ? "b" : "a";
    const flipped = token.slice(0, -1) + last;
    const t2 = await whoami(
      req("http://x/api/token/whoami", {
        headers: { authorization: `Bearer ${flipped}` },
      }),
    );
    expect(t2.status).toBe(401);
  });

  it("token API responses never include the hash: create and list return only allowlisted keys", async () => {
    const { projectId } = await newOwnedProject();
    const created = await createToken(
      json(`http://x/api/projects/${projectId}/tokens`, "POST", {}),
      paramsOf({ id: projectId }),
    );
    const createdText = await created.text();
    const listed = await listTokens(
      req(`http://x/api/projects/${projectId}/tokens`),
      paramsOf({ id: projectId }),
    );
    const listedText = await listed.text();

    for (const text of [createdText, listedText]) expect(text).not.toMatch(/hash/i);
    const createdBody = JSON.parse(createdText) as Record<string, unknown>;
    expect(Object.keys(createdBody).sort()).toEqual(
      ["createdAt", "id", "lastUsedAt", "ok", "revokedAt", "token"].sort(),
    );
    const listedBody = JSON.parse(listedText) as { tokens: Record<string, unknown>[] };
    expect(listedBody.tokens).toHaveLength(1);
    expect(Object.keys(listedBody.tokens[0] ?? {}).sort()).toEqual(
      ["createdAt", "id", "lastUsedAt", "revokedAt"].sort(),
    );
  });
});
