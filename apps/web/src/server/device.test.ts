import { POST as approveRoute } from "@/app/api/device/approve/route";
import { POST as startRoute } from "@/app/api/device/start/route";
import { POST as tokenRoute } from "@/app/api/device/token/route";
import { GET as whoami } from "@/app/api/token/whoami/route";
import { MAX_ACTIVE_TOKENS, projectTokensRepo, projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { approveDevice, pollDevice, startDevice } from "./device";
import { AppError } from "./errors";
import { type TestWorld, createTestWorld } from "./test-helpers";

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let projectId: string;
let strangerProject: string;
const T0 = new Date("2026-10-30T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const req = (ip = "203.0.113.7") =>
  new Request("https://codeceipts.test/api/device/x", {
    method: "POST",
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
  });

beforeEach(async () => {
  // The app's public address comes from BETTER_AUTH_URL; pinned so the test does not depend on the machine's env.
  vi.stubEnv("BETTER_AUTH_URL", "https://codeceipts.test");
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  strangerProject = (await projectsRepo.create(world.db, stranger.id, { name: "theirs" })).id;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await world.teardown();
});

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(() => null).catch((e: unknown) => e);
  if (!(err instanceof AppError)) throw new Error(`expected AppError, got ${String(err)}`);
  return err;
}

describe("npx codeceipt device approval", () => {
  it("start gives a secret device code and a short user code that expires in 10 minutes", async () => {
    const s = await startDevice(world.db, req(), { name: "salon-booking" }, T0);
    expect(s.device_code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(s.expires_in).toBe(600);
    expect(s.interval).toBe(5);
    expect(s.verification_uri).toBe("https://codeceipts.test/device");
    expect(s.verification_uri_complete).toBe(`https://codeceipts.test/device?code=${s.user_code}`);
  });

  it("the owner approves the code for a project and the CLI's next poll gets a working token, once", async () => {
    const s = await startDevice(world.db, req(), {}, T0);
    expect(await pollDevice(world.db, req(), { device_code: s.device_code }, at(5))).toEqual({
      status: 400,
      body: { error: "authorization_pending" },
    });
    await approveDevice(world.db, owner, { user_code: s.user_code, project_id: projectId }, at(6));
    const got = await pollDevice(world.db, req(), { device_code: s.device_code }, at(11));
    expect(got.status).toBe(200);
    const body = got.body as { access_token: string; project_id: string };
    expect(body.project_id).toBe(projectId);
    const who = await whoami(
      new Request("http://x/api/token/whoami", {
        headers: { authorization: `Bearer ${body.access_token}` },
      }),
    );
    expect(((await who.json()) as { project_id: string }).project_id).toBe(projectId);
    // Single use: the same device code never yields a second token.
    expect(await pollDevice(world.db, req(), { device_code: s.device_code }, at(20))).toEqual({
      status: 400,
      body: { error: "invalid_grant" },
    });
  });

  it("approving can create a new project (named after the repo by default) owned by the approver", async () => {
    const s = await startDevice(world.db, req(), { name: "salon-booking" }, T0);
    const result = await approveDevice(
      world.db,
      owner,
      { user_code: s.user_code, new_project_name: "Salon booking" },
      at(1),
    );
    const created = (result as { project_id: string }).project_id;
    const project = await projectsRepo.get(world.db, created, owner.id);
    expect(project?.name).toBe("Salon booking");
  });

  it("boundary: a code expires after 10 minutes, for approval and for polling", async () => {
    const s = await startDevice(world.db, req(), {}, T0);
    const err = await errorOf(
      approveDevice(world.db, owner, { user_code: s.user_code, project_id: projectId }, at(601)),
    );
    expect([err.status, err.code]).toEqual([404, "not_found"]);
    expect(await pollDevice(world.db, req(), { device_code: s.device_code }, at(601))).toEqual({
      status: 400,
      body: { error: "expired_token" },
    });
  });

  it("a denied code tells the CLI so", async () => {
    const s = await startDevice(world.db, req(), {}, T0);
    await approveDevice(world.db, owner, { user_code: s.user_code, deny: true }, at(1));
    expect(await pollDevice(world.db, req(), { device_code: s.device_code }, at(10))).toEqual({
      status: 400,
      body: { error: "access_denied" },
    });
  });

  it("attack: polling faster than the interval is told to slow down, and many polls from one address are refused", async () => {
    const s = await startDevice(world.db, req(), {}, T0);
    await pollDevice(world.db, req(), { device_code: s.device_code }, at(5));
    expect(await pollDevice(world.db, req(), { device_code: s.device_code }, at(6))).toEqual({
      status: 400,
      body: { error: "slow_down" },
    });
    let refused: AppError | null = null;
    for (let i = 0; i < 40 && !refused; i++) {
      refused = await pollDevice(
        world.db,
        req("198.51.100.9"),
        { device_code: "x".repeat(43) },
        at(7),
      ).then(
        () => null,
        (e: AppError) => e,
      );
    }
    expect([refused?.status, refused?.code]).toEqual([429, "rate_limited"]);
  });

  it("attack: starting codes is rate limited per address", async () => {
    let refused: AppError | null = null;
    for (let i = 0; i < 20 && !refused; i++) {
      refused = await startDevice(world.db, req("192.0.2.44"), {}, T0).then(
        () => null,
        (e: AppError) => e,
      );
    }
    expect([refused?.status, refused?.code]).toEqual([429, "rate_limited"]);
  });

  it("permission: nobody can approve a code for a project they do not own, and the code stays pending", async () => {
    const s = await startDevice(world.db, req(), {}, T0);
    const err = await errorOf(
      approveDevice(
        world.db,
        owner,
        { user_code: s.user_code, project_id: strangerProject },
        at(1),
      ),
    );
    expect([err.status, err.code]).toEqual([404, "not_found"]);
    expect(await pollDevice(world.db, req(), { device_code: s.device_code }, at(5))).toEqual({
      status: 400,
      body: { error: "authorization_pending" },
    });
  });

  it("attack: guessing user codes is refused (404) and limited per user", async () => {
    let refused: AppError | null = null;
    for (let i = 0; i < 30 && !refused; i++) {
      const err = await errorOf(
        approveDevice(world.db, owner, { user_code: "BCDF-GHJK", project_id: projectId }, T0),
      );
      if (err.status === 429) refused = err;
      else expect(err.status).toBe(404);
    }
    expect(refused?.code).toBe("rate_limited");
  });

  it("permission: the routes need a signed-in user to approve; start and poll need no login", async () => {
    world.signInAs(null);
    const start = await startRoute(
      new Request("http://x/api/device/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "app" }),
      }),
    );
    expect(start.status).toBe(200);
    const s = (await start.json()) as { device_code: string; user_code: string };
    const approve = await approveRoute(
      new Request("http://x/api/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_code: s.user_code, project_id: projectId }),
      }),
    );
    expect(approve.status).toBe(401);
    const poll = await tokenRoute(
      new Request("http://x/api/device/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: s.device_code }),
      }),
    );
    expect(poll.status).toBe(400);
    expect(await poll.json()).toEqual({ error: "authorization_pending" });
  });

  it("a project at its token limit gets a clear token_limit answer, mints nothing, and works again once one is revoked", async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_ACTIVE_TOKENS; i++) {
      ids.push((await projectTokensRepo.create(world.db, projectId)).row.id);
    }
    const s = await startDevice(world.db, req(), {}, T0);
    await approveDevice(world.db, owner, { user_code: s.user_code, project_id: projectId }, at(1));
    const full = await pollDevice(world.db, req(), { device_code: s.device_code }, at(6));
    expect(full).toEqual({ status: 400, body: { error: "token_limit" } });
    await projectTokensRepo.revoke(world.db, projectId, ids[0] ?? "");
    const ok = await pollDevice(world.db, req(), { device_code: s.device_code }, at(12));
    expect(ok.status).toBe(200);
  });

  it("attack: project names with control or text-direction characters are refused (create, and the approval form)", async () => {
    const s = await startDevice(world.db, req(), {}, T0);
    const err = await errorOf(
      approveDevice(
        world.db,
        owner,
        { user_code: s.user_code, new_project_name: "shop\u202etxt" },
        at(1),
      ),
    );
    expect(err.status).toBe(400);
    world.signInAs(owner);
    const { POST: createProject } = await import("@/app/api/projects/route");
    const res = await createProject(
      new Request("https://codeceipts.test/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "a\u0007b" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
