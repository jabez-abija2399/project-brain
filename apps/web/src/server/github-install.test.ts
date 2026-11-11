import { GET as callbackRoute } from "@/app/api/github/callback/route";
import { GET as install } from "@/app/api/github/install/route";
import { POST as linkRouteRaw } from "@/app/api/github/link/route";
import { GET as reposRoute } from "@/app/api/github/repos/route";
import { githubRepo, projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth";
import {
  type FakeRepo,
  cookieJar,
  makeGithubConfig,
  mockGithub,
  restoreGithub,
} from "./github-test-helpers";
import { type TestWorld, createTestWorld } from "./test-helpers";

// The browser's part: cookies set by the callback go with the selection screen's requests.
const jar = cookieJar();
const callback = (req: Request) => callbackRoute(req).then((r) => jar.remember(r));
const repos = (req: Request) => reposRoute(jar.attach(req));
const linkRoute = (req: Request) => linkRouteRaw(jar.attach(req));

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
  jar.clear();
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

describe("GitHub App install: only repositories the person can access (owner-approved fix, 2026-11-11)", () => {
  const post = (body: unknown) =>
    linkRoute(
      new Request("http://localhost/api/github/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  const list = (state: string) =>
    repos(new Request(`http://localhost/api/github/repos?state=${state}`));

  it("AC-009-01 attack: a collaborator on one repository of an installation sees and links only the repositories they can access", async () => {
    mockGithub(
      github({
        installations: { 77: ["acme/app", "acme/site", "victim/private"] },
        userRepos: { 77: ["acme/app", "acme/site"] },
      }),
    );
    const state = await stateFor(owner);
    expect((await callBack(state)).status).toBe(303);
    expect(await (await list(state)).json()).toEqual({
      ok: true,
      repos: ["acme/app", "acme/site"],
    });
    const res = await post({ state, repo: "victim/private" });
    expect(res.status).toBe(404);
    expect(await githubRepo.linkedProjects(world.db, 77, "victim/private")).toEqual([]);
    expect((await post({ state, repo: "acme/site" })).status).toBe(200);
  });

  it("AC-009-01 attack: one accessible repository in a larger installation is linked directly, never another one", async () => {
    mockGithub(
      github({
        installations: { 77: ["acme/app", "victim/private"] },
        userRepos: { 77: ["acme/app"] },
      }),
    );
    const state = await stateFor(owner);
    const res = await callBack(state);
    expect(res.headers.get("location")).toBe("http://localhost/projects?github=linked");
    expect(await linked()).toEqual([projectId]);
    expect(await githubRepo.linkedProjects(world.db, 77, "victim/private")).toEqual([]);
  });

  it("AC-009-01 attack: no accessible repository links nothing (404), and a failing GitHub answer links nothing (400)", async () => {
    mockGithub(github({ installations: { 77: ["victim/private"] }, userRepos: { 77: [] } }));
    const state = await stateFor(owner);
    const res = await callBack(state);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("no_accessible_repository");
    expect(await githubRepo.linkedProjects(world.db, 77, "victim/private")).toEqual([]);

    // GitHub refuses the per-person list: the install stops, nothing is linked.
    const gh = mockGithub(github({ userRepos: { 77: ["acme/app"] } }));
    gh.repo.userInstallations = [77];
    const state2 = await stateFor(owner);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/user/installations/77/repositories")) {
        return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    expect((await callBack(state2)).status).toBe(400);
    expect(await linked()).toEqual([]);
  });

  it("AC-009-01 attack: without the callback's cookie, with a forged one, or with another install's, nothing is listed or linked", async () => {
    mockGithub(github({ installations: { 77: ["acme/app", "acme/site", "victim/private"] } }));
    const first = await stateFor(owner);
    expect((await callBack(first)).status).toBe(303);
    const other = await stateFor(owner);
    expect((await callBack(other)).status).toBe(303);
    // The jar now holds the cookie made for `other`; it does not open `first`.
    expect((await list(first)).status).toBe(200);
    expect((await (await list(first)).json()).repos).toEqual([]);
    expect((await post({ state: first, repo: "victim/private" })).status).toBe(404);

    jar.clear();
    expect((await list(other)).status).toBe(400);
    expect((await post({ state: other, repo: "acme/app" })).status).toBe(400);

    const forged = (value: string) =>
      reposRoute(
        new Request(`http://localhost/api/github/repos?state=${other}`, {
          headers: { cookie: `cc_gh_repos=${value}` },
        }),
      );
    for (const value of ["", "x", "A".repeat(22), `${"A".repeat(22)}.${"B".repeat(22)}`, "%%"]) {
      const res = await forged(value);
      if (res.status === 200) expect((await res.json()).repos).toEqual([]);
      else expect(res.status).toBe(400);
    }
    expect(await githubRepo.linkedProjects(world.db, 77, "victim/private")).toEqual([]);
  });

  it("AC-009-01 the selection cookie is http-only, scoped to the GitHub API routes, short-lived and names no repository", async () => {
    mockGithub(github({ installations: { 77: ["acme/app", "acme/site"] } }));
    const state = await stateFor(owner);
    const res = await callbackRoute(
      new Request(
        `http://localhost/api/github/callback?installation_id=77&setup_action=install&state=${state}&code=${code()}`,
      ),
    );
    const [cookie = ""] = res.headers.getSetCookie();
    expect(cookie).toMatch(/^cc_gh_repos=[A-Za-z0-9_.-]+;/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Path=/api/github");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).not.toContain("acme");
  });

  it("AC-009-01 attack: read-only access to a repository is not enough to link it", async () => {
    mockGithub(
      github({
        installations: { 77: ["acme/app", "org/private", "org/site"] },
        userAccess: { "org/private": "read", "org/site": "admin" },
      }),
    );
    const state = await stateFor(owner);
    expect((await callBack(state)).status).toBe(303);
    expect(await (await list(state)).json()).toEqual({ ok: true, repos: ["acme/app", "org/site"] });
    expect((await post({ state, repo: "org/private" })).status).toBe(404);
    expect(await githubRepo.linkedProjects(world.db, 77, "org/private")).toEqual([]);

    // Only read access everywhere: nothing to link.
    mockGithub(
      github({ installations: { 77: ["org/private"] }, userAccess: { "org/private": "read" } }),
    );
    const res = await callBack(await stateFor(owner));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("no_accessible_repository");
  });

  it("AC-009-01 a list cut at 100 never links on the person's behalf: the selection screen is shown instead", async () => {
    mockGithub(
      github({
        installations: { 77: ["acme/app", "victim/private"] },
        userRepos: { 77: ["acme/app"] },
        userReposTotal: 150,
      }),
    );
    const state = await stateFor(owner);
    const res = await callBack(state);
    expect(res.headers.get("location")).toBe(`http://localhost/github/select?state=${state}`);
    expect(await linked()).toEqual([]);
    expect(await (await list(state)).json()).toEqual({ ok: true, repos: ["acme/app"] });

    mockGithub(github({ installations: { 77: ["acme/app"] }, installationReposTotal: 300 }));
    const state2 = await stateFor(owner);
    expect((await callBack(state2)).headers.get("location")).toBe(
      `http://localhost/github/select?state=${state2}`,
    );
  });

  it("AC-009-01 the selection cookie is cleared after a link, and by a flow that links at once", async () => {
    mockGithub(github({ installations: { 77: ["acme/app", "acme/site"] } }));
    const state = await stateFor(owner);
    await callBack(state);
    const res = await post({ state, repo: "acme/site" });
    expect(res.status).toBe(200);
    const [cleared = ""] = res.headers.getSetCookie();
    expect(cleared).toMatch(/^cc_gh_repos=;/);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Path=/api/github");

    mockGithub(github());
    const once = await callbackRoute(
      new Request(
        `http://localhost/api/github/callback?installation_id=77&setup_action=install&state=${await stateFor(owner)}&code=${code()}`,
      ),
    );
    expect(once.headers.get("location")).toBe("http://localhost/projects?github=linked");
    expect(once.headers.getSetCookie()[0]).toMatch(/^cc_gh_repos=;.*Max-Age=0/);
  });
});
