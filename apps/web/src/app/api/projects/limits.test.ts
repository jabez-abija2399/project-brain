import { DELETE as revokeToken } from "@/app/api/projects/[id]/tokens/[tokenId]/route";
import { POST as createToken, GET as listTokens } from "@/app/api/projects/[id]/tokens/route";
import { GET as listProjects } from "@/app/api/projects/route";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { projectsRepo } from "@brain/db";
import { projectTokens } from "@brain/db/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function req(url: string, method = "GET") {
  return new Request(url, { method, headers: { "content-type": "application/json" } });
}
function paramsOf<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}

describe("FEAT-003 limits: active tokens per project and list pagination", () => {
  let world: TestWorld;

  beforeEach(async () => {
    world = await createTestWorld();
  });
  afterEach(async () => {
    await world.teardown();
  });

  it("allows 20 active tokens per project; the 21st returns 409 until one is revoked", async () => {
    const user = await world.createUser();
    world.signInAs(user);
    const project = await projectsRepo.create(world.db, user.id, { name: "demo" });
    const url = `http://x/api/projects/${project.id}/tokens`;

    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      const res = await createToken(req(url, "POST"), paramsOf({ id: project.id }));
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as { tokenId: string }).tokenId);
    }

    const over = await createToken(req(url, "POST"), paramsOf({ id: project.id }));
    expect(over.status).toBe(409);
    const body = (await over.json()) as { code: string; message?: string };
    expect(body.code).toBe("token_limit_reached");
    expect(body.message).toMatch(/20 active tokens/);
    const count = await world.pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM project_tokens WHERE project_id = $1",
      [project.id],
    );
    expect(count.rows[0]?.n).toBe(20);

    const tokenId = ids[0] as string;
    const revoked = await revokeToken(
      req(`${url}/${tokenId}`, "DELETE"),
      paramsOf({ id: project.id, tokenId }),
    );
    expect(revoked.status).toBe(200);
    const again = await createToken(req(url, "POST"), paramsOf({ id: project.id }));
    expect(again.status).toBe(201);
  });

  it("GET /api/projects returns at most 50 rows per page with a next offset", async () => {
    const user = await world.createUser();
    world.signInAs(user);
    for (let i = 0; i < 55; i++) {
      await projectsRepo.create(world.db, user.id, { name: `p${i}` });
    }

    const first = await listProjects(req("http://x/api/projects"));
    expect(first.status).toBe(200);
    const page1 = (await first.json()) as { projects: { id: string }[]; nextOffset: number | null };
    expect(page1.projects).toHaveLength(50);
    expect(page1.nextOffset).toBe(50);

    const second = await listProjects(req("http://x/api/projects?offset=50"));
    const page2 = (await second.json()) as {
      projects: { id: string }[];
      nextOffset: number | null;
    };
    expect(page2.projects).toHaveLength(5);
    expect(page2.nextOffset).toBeNull();
    const all = new Set([...page1.projects, ...page2.projects].map((p) => p.id));
    expect(all.size).toBe(55);

    const small = await listProjects(req("http://x/api/projects?limit=10"));
    expect(((await small.json()) as { projects: unknown[] }).projects).toHaveLength(10);
  });

  it("GET /api/projects/[id]/tokens returns at most 50 rows per page with a next offset", async () => {
    const user = await world.createUser();
    world.signInAs(user);
    const project = await projectsRepo.create(world.db, user.id, { name: "demo" });
    // Revoked tokens do not count toward the active cap but still appear in the list.
    await world.db.insert(projectTokens).values(
      Array.from({ length: 55 }, (_, i) => ({
        projectId: project.id,
        hash: `${i}`.padStart(64, "0"),
        revokedAt: new Date(),
      })),
    );
    const url = `http://x/api/projects/${project.id}/tokens`;

    const first = await listTokens(req(url), paramsOf({ id: project.id }));
    expect(first.status).toBe(200);
    const page1 = (await first.json()) as { tokens: { id: string }[]; nextOffset: number | null };
    expect(page1.tokens).toHaveLength(50);
    expect(page1.nextOffset).toBe(50);

    const second = await listTokens(req(`${url}?offset=50`), paramsOf({ id: project.id }));
    const page2 = (await second.json()) as { tokens: { id: string }[]; nextOffset: number | null };
    expect(page2.tokens).toHaveLength(5);
    expect(page2.nextOffset).toBeNull();
  });

  it("rejects a page size above 50 or an invalid offset with 400", async () => {
    const user = await world.createUser();
    world.signInAs(user);
    const project = await projectsRepo.create(world.db, user.id, { name: "demo" });

    for (const qs of ["limit=51", "limit=0", "limit=abc", "offset=-1"]) {
      const p = await listProjects(req(`http://x/api/projects?${qs}`));
      expect(p.status, qs).toBe(400);
      const t = await listTokens(
        req(`http://x/api/projects/${project.id}/tokens?${qs}`),
        paramsOf({ id: project.id }),
      );
      expect(t.status, qs).toBe(400);
    }
  });
});
