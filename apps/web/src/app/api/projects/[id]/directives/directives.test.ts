import type { SessionUser } from "@/server/auth";
import { saveDirective } from "@/server/session-tools";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { directivesRepo, projectTokensRepo, projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATCH } from "./[did]/route";

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let projectId: string;
let token: { id: string; projectId: string };
let directiveId: string;

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "demo" })).id;
  token = (await projectTokensRepo.create(world.db, projectId)).row;
  const saved = await saveDirective(world.db, token, { projectId, text: "no Docker" });
  directiveId = saved.id;
});

afterEach(() => world.teardown());

function patch(id: string, did: string, body: unknown, headers: Record<string, string> = {}) {
  const req = new Request(`http://localhost/api/projects/${id}/directives/${did}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id, did }) });
}

async function statusOf(): Promise<string> {
  const rows = await directivesRepo.listActive(world.db, projectId);
  return rows.length > 0 ? "active" : "proposal";
}

describe("PATCH /api/projects/:id/directives/:did (FEAT-010 owner confirmation)", () => {
  it("AC-010-07 the owner confirms a proposal in the dashboard and it becomes active", async () => {
    world.signInAs(owner);
    const res = await patch(projectId, directiveId, { status: "active" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; directive: { id: string; status: string } };
    expect(body).toMatchObject({ ok: true, directive: { id: directiveId, status: "active" } });
    expect(await statusOf()).toBe("active");
  });

  it("AC-010-07 an MCP token cannot confirm its own directive (401, still a proposal)", async () => {
    world.signInAs(null);
    const res = await patch(
      projectId,
      directiveId,
      { status: "active" },
      {
        authorization: `Bearer ${(await projectTokensRepo.create(world.db, projectId)).token}`,
      },
    );
    expect(res.status).toBe(401);
    expect(await statusOf()).toBe("proposal");
  });

  it("AC-010-05 another signed-in user gets 404 and the directive stays a proposal", async () => {
    world.signInAs(stranger);
    const res = await patch(projectId, directiveId, { status: "active" });
    expect(res.status).toBe(404);
    expect(await statusOf()).toBe("proposal");
  });

  it("AC-010-07 only status 'active' is accepted, and unknown fields are refused", async () => {
    world.signInAs(owner);
    const dismissed = await patch(projectId, directiveId, { status: "dismissed" });
    expect(dismissed.status).toBe(400);
    const extra = await patch(projectId, directiveId, { status: "active", text: "rewritten" });
    expect(extra.status).toBe(400);
    expect(await statusOf()).toBe("proposal");
  });

  it("AC-010-05 an unknown directive id returns 404", async () => {
    world.signInAs(owner);
    const res = await patch(projectId, "missing-directive", { status: "active" });
    expect(res.status).toBe(404);
  });
});
