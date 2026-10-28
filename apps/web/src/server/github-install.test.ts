import { GET as callback } from "@/app/api/github/callback/route";
import { GET as install } from "@/app/api/github/install/route";
import { POST as linkRoute } from "@/app/api/github/link/route";
import { GET as repos } from "@/app/api/github/repos/route";
import { githubRepo, projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth";
import { type FakeRepo, makeGithubConfig, mockGithub, restoreGithub } from "./github-test-helpers";
import { type TestWorld, createTestWorld } from "./test-helpers";

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let projectId: string;
const code = () => ["code", "x".repeat(20)].join("");

const github = (over: Partial<FakeRepo> = {}): FakeRepo => ({
  installations: { 77: ["acme/app"] },
  userInstallations: [77],
  compare: {},
  files: {},
  ...over,
});

beforeEach(async () => {
  world = await createTestWorld();
  makeGithubConfig();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "app" })).id;
});

afterEach(async () => {
  restoreGithub();
  await world.teardown();
});

// Starts the install as `user` and returns the state from GitHub's install URL.
async function startInstall(user: SessionUser, pid = projectId): Promise<Response> {
  world.signInAs(user);
  return install(new Request(`http://localhost/api/github/install?projectId=${pid}`));
}
async function stateFor(user: SessionUser): Promise<string> {
  const res = await startInstall(user);
  return new URL(res.headers.get("location") ?? "").searchParams.get("state") ?? "";
}
function callBack(state: string, installationId = 77) {
  return callback(
    new Request(
      `http://localhost/api/github/callback?installation_id=${installationId}&setup_action=install&state=${state}&code=${code()}`,
    ),
  );
}
const linked = async () =>
  (await githubRepo.linkedProjects(world.db, 77, "acme/app")).map((p) => p.id);

describe("GitHub App install flow (FEAT-009)", () => {
  it("AC-009-01 the owner installs the App on one repo and it is linked to the project", async () => {
    mockGithub(github());
    const start = await startInstall(owner);
    expect(start.status).toBe(302);
    const to = new URL(start.headers.get("location") ?? "");
    expect(`${to.origin}${to.pathname}`).toBe(
      "https://github.com/apps/project-brain-test/installations/new",
    );
    const state = to.searchParams.get("state") ?? "";
    expect(state.length).toBeGreaterThanOrEqual(40);

    const res = await callBack(state);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost/projects?github=linked");
    expect(await linked()).toEqual([projectId]);
  });

  it("AC-009-01 an installation with several repos goes to the repo selection screen, then links the chosen one", async () => {
    mockGithub(github({ installations: { 77: ["acme/app", "acme/site"] } }));
    const state = await stateFor(owner);
    const res = await callBack(state);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`http://localhost/github/select?state=${state}`);
    expect(await linked()).toEqual([]);

    const list = await repos(new Request(`http://localhost/api/github/repos?state=${state}`));
    expect(await list.json()).toEqual({ ok: true, repos: ["acme/app", "acme/site"] });
    const chosen = await linkRoute(
      new Request("http://localhost/api/github/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state, repo: "acme/site" }),
      }),
    );
    expect(chosen.status).toBe(200);
    expect(await chosen.json()).toEqual({ ok: true, projectId, repo: "acme/site" });
    expect((await githubRepo.linkedProjects(world.db, 77, "acme/site")).map((p) => p.id)).toEqual([
      projectId,
    ]);
  });

  it("AC-009-01 attack: an installation id the signed-in GitHub user cannot access is not linked (404)", async () => {
    mockGithub(github({ installations: { 99: ["victim/private"] }, userInstallations: [77] }));
    const state = await stateFor(owner);
    const res = await callBack(state, 99);
    expect(res.status).toBe(404);
    expect(await githubRepo.linkedProjects(world.db, 99, "victim/private")).toEqual([]);
  });

  it("AC-009-01 attack: another signed-in user cannot finish the owner's install with the owner's state", async () => {
    mockGithub(github());
    const state = await stateFor(owner);
    world.signInAs(stranger);
    const res = await callBack(state);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_state");
    expect(await linked()).toEqual([]);
  });

  it("AC-009-01 attack: a user cannot start the install for a project they do not own (404)", async () => {
    mockGithub(github());
    const res = await startInstall(stranger);
    expect(res.status).toBe(404);
  });

  it("AC-009-01 attack: a state works once; a replay or a made-up state is refused", async () => {
    mockGithub(github());
    const state = await stateFor(owner);
    expect((await callBack(state)).status).toBe(303);
    const replay = await callBack(state);
    expect(replay.status).toBe(400);
    expect((await replay.json()).code).toBe("invalid_state");
    const madeUp = await callBack("A".repeat(43));
    expect(madeUp.status).toBe(400);
  });

  it("AC-009-01 attack: the selection screen cannot link a repo outside the verified installation", async () => {
    mockGithub(github({ installations: { 77: ["acme/app", "acme/site"] } }));
    const state = await stateFor(owner);
    await callBack(state);
    const res = await linkRoute(
      new Request("http://localhost/api/github/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state, repo: "victim/private" }),
      }),
    );
    expect(res.status).toBe(404);
    expect(await githubRepo.linkedProjects(world.db, 77, "victim/private")).toEqual([]);
  });

  it("AC-009-01 permission: every install route needs a session (401)", async () => {
    mockGithub(github());
    world.signInAs(null);
    expect(
      (await install(new Request(`http://localhost/api/github/install?projectId=${projectId}`)))
        .status,
    ).toBe(401);
    expect((await callBack("A".repeat(43))).status).toBe(401);
    expect((await repos(new Request("http://localhost/api/github/repos?state=x"))).status).toBe(
      401,
    );
    const post = await linkRoute(
      new Request("http://localhost/api/github/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "x", repo: "acme/app" }),
      }),
    );
    expect(post.status).toBe(401);
  });
});
