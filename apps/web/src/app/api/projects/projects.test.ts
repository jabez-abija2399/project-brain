import { GET as getProject, PATCH as patchProject } from "@/app/api/projects/[id]/route";
import { DELETE as deleteToken } from "@/app/api/projects/[id]/tokens/[tokenId]/route";
import { POST as createToken } from "@/app/api/projects/[id]/tokens/route";
import { POST as createProject, GET as listProjects } from "@/app/api/projects/route";
import { GET as whoami } from "@/app/api/token/whoami/route";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const JSON_HEADERS = { "content-type": "application/json" };

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body),
  });
}
function patch(url: string, body: unknown) {
  return new Request(url, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}
function get(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { method: "GET", headers });
}
function del(url: string) {
  return new Request(url, { method: "DELETE" });
}
function paramsOf<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}

describe("FEAT-003 /api/projects and /api/token/whoami", () => {
  let world: TestWorld;

  beforeEach(async () => {
    world = await createTestWorld();
  });
  afterEach(async () => {
    await world.teardown();
  });

  it("AC-003-01 signed-in user creates project 'demo' and sees it in the list", async () => {
    const user = await world.createUser();
    world.signInAs(user);

    const createRes = await createProject(post("http://x/api/projects", { name: "demo" }));
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as {
      ok: boolean;
      project: { id: string; name: string };
    };
    expect(createBody.ok).toBe(true);
    expect(createBody.project.name).toBe("demo");

    const listRes = await listProjects(get("http://x/api/projects"));
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { projects: Array<{ name: string }> };
    expect(listBody.projects.map((p) => p.name)).toContain("demo");
  });

  it("AC-003-02 signed-out requests to /api/projects/* return 401", async () => {
    world.signInAs(null);

    const listRes = await listProjects(get("http://x/api/projects"));
    expect(listRes.status).toBe(401);

    const createRes = await createProject(post("http://x/api/projects", { name: "demo" }));
    expect(createRes.status).toBe(401);

    const getRes = await getProject(
      get("http://x/api/projects/anything"),
      paramsOf({ id: "anything" }),
    );
    expect(getRes.status).toBe(401);
  });

  it("AC-003-03 user B requesting user A's project id returns 404 (not 403, not 200)", async () => {
    const userA = await world.createUser({ name: "Alice" });
    const userB = await world.createUser({ name: "Bob" });

    world.signInAs(userA);
    const aCreate = await createProject(post("http://x/api/projects", { name: "A-secret" }));
    const aBody = (await aCreate.json()) as { project: { id: string } };
    const aProjectId = aBody.project.id;

    world.signInAs(userB);
    const res = await getProject(
      get(`http://x/api/projects/${aProjectId}`),
      paramsOf({ id: aProjectId }),
    );
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(403);
  });

  it("AC-003-04 user B PATCH on user A's project id returns 404 and name unchanged", async () => {
    const userA = await world.createUser({ name: "Alice" });
    const userB = await world.createUser({ name: "Bob" });

    world.signInAs(userA);
    const aCreate = await createProject(post("http://x/api/projects", { name: "A-original" }));
    const aBody = (await aCreate.json()) as { project: { id: string } };
    const aProjectId = aBody.project.id;

    world.signInAs(userB);
    const res = await patchProject(
      patch(`http://x/api/projects/${aProjectId}`, { name: "A-hijacked" }),
      paramsOf({ id: aProjectId }),
    );
    expect(res.status).toBe(404);

    const row = await world.pg.query<{ name: string }>("SELECT name FROM projects WHERE id = $1", [
      aProjectId,
    ]);
    expect(row.rows[0]?.name).toBe("A-original");
  });

  it("AC-003-05 creating a project with empty or >80-char name returns 400 with a field error", async () => {
    const user = await world.createUser();
    world.signInAs(user);

    const emptyRes = await createProject(post("http://x/api/projects", { name: "" }));
    expect(emptyRes.status).toBe(400);
    const emptyBody = (await emptyRes.json()) as {
      code: string;
      fieldErrors?: Record<string, string>;
    };
    expect(emptyBody.code).toBe("invalid_input");
    expect(emptyBody.fieldErrors?.name).toBeTruthy();

    const longName = "x".repeat(81);
    const longRes = await createProject(post("http://x/api/projects", { name: longName }));
    expect(longRes.status).toBe(400);
    const longBody = (await longRes.json()) as {
      code: string;
      fieldErrors?: Record<string, string>;
    };
    expect(longBody.code).toBe("invalid_input");
    expect(longBody.fieldErrors?.name).toBeTruthy();
  });

  it("AC-003-06 a revoked token is rejected with 401 by GET /api/token/whoami", async () => {
    const user = await world.createUser();
    world.signInAs(user);

    const createRes = await createProject(post("http://x/api/projects", { name: "demo" }));
    const { project } = (await createRes.json()) as { project: { id: string } };

    const tokenRes = await createToken(
      post(`http://x/api/projects/${project.id}/tokens`, {}),
      paramsOf({ id: project.id }),
    );
    expect(tokenRes.status).toBe(201);
    const { token, tokenId } = (await tokenRes.json()) as { token: string; tokenId: string };

    const liveRes = await whoami(
      get("http://x/api/token/whoami", { authorization: `Bearer ${token}` }),
    );
    expect(liveRes.status).toBe(200);
    const liveBody = (await liveRes.json()) as { project_id: string };
    expect(liveBody.project_id).toBe(project.id);

    const revokeRes = await deleteToken(
      del(`http://x/api/projects/${project.id}/tokens/${tokenId}`),
      paramsOf({ id: project.id, tokenId }),
    );
    expect(revokeRes.status).toBe(200);

    const deadRes = await whoami(
      get("http://x/api/token/whoami", { authorization: `Bearer ${token}` }),
    );
    expect(deadRes.status).toBe(401);
  });

  it("AC-003-07 project tokens are stored only as hashes; the value appears once in the create response and nowhere in the database", async () => {
    const user = await world.createUser();
    world.signInAs(user);

    const createProjRes = await createProject(post("http://x/api/projects", { name: "demo" }));
    const { project } = (await createProjRes.json()) as { project: { id: string } };

    const tokenRes = await createToken(
      post(`http://x/api/projects/${project.id}/tokens`, {}),
      paramsOf({ id: project.id }),
    );
    const { token } = (await tokenRes.json()) as { token: string };
    expect(token).toMatch(/^pb_/);

    // The token's plaintext value must not appear anywhere in the DB.
    const rows = await world.pg.query<Record<string, unknown>>("SELECT * FROM project_tokens");
    expect(rows.rows).toHaveLength(1);
    const hash = rows.rows[0]?.hash as string | undefined;
    expect(hash).not.toBe(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    for (const row of rows.rows) {
      for (const value of Object.values(row)) {
        if (typeof value === "string") expect(value).not.toContain(token);
      }
    }

    // Listing tokens via the API must not return the plaintext either.
    const listUrl = `http://x/api/projects/${project.id}/tokens`;
    const listResponse = await (await import("@/app/api/projects/[id]/tokens/route")).GET(
      get(listUrl),
      paramsOf({ id: project.id }),
    );
    const listText = await listResponse.text();
    expect(listText).not.toContain(token);
  });
});
