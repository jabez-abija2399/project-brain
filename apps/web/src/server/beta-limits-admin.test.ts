import LimitsAdminPage from "@/app/admin/limits/page";
// FEAT-041: flexible beta limits. Admins create any number of projects; an admin changes the default limits and
// gives specific users their own (null = no limit); only admins can; bad input changes nothing; every change is in
// the audit log; before migration 0058 the built-in limits hold. Attacker tests are named "attack: ...".
import { POST as limitsRoute } from "@/app/api/admin/limits/route";
import { POST as approveRoute } from "@/app/api/device/approve/route";
import { POST as createProjectRoute } from "@/app/api/projects/route";
import { BETA } from "@brain/core";
import { adminAuditRepo, projectTokensRepo, projectsRepo, usageLimitsRepo } from "@brain/db";
import { sql } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountView } from "./account";
import { setGithubLoginResolverForTests } from "./admin";
import type { SessionUser } from "./auth";
import { judgeAllowed } from "./billing";
import { startDevice } from "./device";
import { effectiveLimits } from "./limits";
import { resetMigrationCheckForTests } from "./migration-check";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}));

const ORIGIN = "https://codeceipt.example.com";
let world: TestWorld;
let admin: SessionUser;
let maker: SessionUser;
let other: SessionUser;
beforeEach(async () => {
  resetMigrationCheckForTests();
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("BETA_LIMITS", "on");
  vi.stubEnv("BETTER_AUTH_URL", ORIGIN);
  vi.stubEnv("ADMIN_GITHUB_LOGINS", "boss-gh");
  world = await createTestWorld();
  admin = await world.createUser({ name: "Boss", email: "boss@example.com" });
  maker = await world.createUser({ name: "Maker", email: "Maker@Example.com" });
  other = await world.createUser({ name: "Other", email: "other@example.com" });
  const logins = new Map([
    [admin.id, "boss-gh"],
    [maker.id, "maker-gh"],
    [other.id, "other-gh"],
  ]);
  setGithubLoginResolverForTests(async (u) => logins.get(u.id) ?? null);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setGithubLoginResolverForTests(null);
  resetMigrationCheckForTests();
  await world.teardown();
});

const post = (
  route: (r: Request) => Promise<Response>,
  path: string,
  body: unknown,
  headers = {},
) =>
  route(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    }),
  );
const createProject = (name: string) => post(createProjectRoute, "/api/projects", { name });
const setLimits = (body: unknown, headers = {}) =>
  post(limitsRoute, "/api/admin/limits", body, headers);
const owned = async (id: string) =>
  (await projectsRepo.listByOwner(world.db, id, { limit: 50, offset: 0 })).items.length;
async function fill(user: SessionUser, n: number) {
  for (let i = 0; i < n; i++) await projectsRepo.create(world.db, user.id, { name: `p${i}` });
}
const page = async () => renderToStaticMarkup((await LimitsAdminPage()) as ReactElement);

describe("FEAT-041 flexible beta limits", () => {
  it("AC-041-01 an admin creates more projects than the limit (web and CLI); a normal user still stops at the limit", async () => {
    await fill(admin, BETA.projects);
    world.signInAs(admin);
    expect((await createProject("one more")).status).toBe(201);
    const req = new Request(`${ORIGIN}/api/device/start`, {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.7" },
    });
    const code = (await startDevice(world.db, req, { name: "app" })).user_code;
    const viaCli = await post(approveRoute, "/api/device/approve", {
      user_code: code,
      new_project_name: "from the CLI",
    });
    expect(viaCli.status).toBe(200);
    expect(await owned(admin.id)).toBe(BETA.projects + 2);
    await fill(maker, BETA.projects);
    world.signInAs(maker);
    const refused = await createProject("fourth");
    expect(refused.status).toBe(402);
    expect(await owned(maker.id)).toBe(BETA.projects);
  });

  it("AC-041-02 the admin's default limits apply to everyone without their own at once; empty means no limit", async () => {
    world.signInAs(admin);
    expect((await setLimits({ scope: "default", projects: 5, judgedPerMonth: 7 })).status).toBe(
      200,
    );
    expect(await effectiveLimits(world.db, maker.id)).toEqual({
      projects: 5,
      judgedPerMonth: 7,
      source: "default",
    });
    await fill(maker, 4);
    world.signInAs(maker);
    expect((await createProject("fifth")).status).toBe(201);
    expect((await createProject("sixth")).status).toBe(402);
    const view = await accountView(world.db, maker);
    expect(view.billing.beta).toMatchObject({ projectLimit: 5, judgedLimit: 7 });
    // The AI check follows the default too: 7 a month, then no more.
    const pid = (await projectsRepo.listByOwner(world.db, maker.id, { limit: 1, offset: 0 }))
      .items[0]?.id as string;
    const allowed = [];
    for (let i = 0; i < 8; i++) allowed.push(await judgeAllowed(world.db, pid));
    expect(allowed.filter(Boolean)).toHaveLength(7);
    // No limit.
    world.signInAs(admin);
    expect(
      (await setLimits({ scope: "default", projects: null, judgedPerMonth: null })).status,
    ).toBe(200);
    world.signInAs(maker);
    expect((await createProject("seventh")).status).toBe(201);
    expect((await accountView(world.db, maker)).billing.beta).toMatchObject({
      projectLimit: null,
      judgedLimit: null,
    });
  });

  it("AC-041-03 a user's own limits (found by email, any case) win over the default; removing them restores it", async () => {
    world.signInAs(admin);
    await setLimits({ scope: "default", projects: 2, judgedPerMonth: 10 });
    const res = await setLimits({
      scope: "user",
      email: "maker@example.COM",
      projects: 20,
      judgedPerMonth: null,
    });
    expect(res.status).toBe(200);
    expect(await effectiveLimits(world.db, maker.id)).toEqual({
      projects: 20,
      judgedPerMonth: null,
      source: "user",
    });
    expect((await effectiveLimits(world.db, other.id)).projects).toBe(2);
    const html = await page();
    expect(html).toContain(`data-user-limit="${maker.id}"`);
    expect(html).toContain("Users with their own limits (1)");
    expect((await setLimits({ scope: "clear", userId: maker.id })).status).toBe(200);
    expect(await effectiveLimits(world.db, maker.id)).toEqual({
      projects: 2,
      judgedPerMonth: 10,
      source: "default",
    });
  });

  it("AC-041-04 attack: signed out, a signed-in non-admin, or a project token gets 404 and nothing changes", async () => {
    const token = (
      await projectTokensRepo.create(
        world.db,
        (
          await projectsRepo.create(world.db, maker.id, { name: "m" })
        ).id,
      )
    ).token;
    const attempts: [SessionUser | null, Record<string, string>][] = [
      [null, {}],
      [maker, {}],
      [null, { authorization: `Bearer ${token}` }],
    ];
    for (const [who, headers] of attempts) {
      world.signInAs(who);
      for (const body of [
        { scope: "default", projects: null, judgedPerMonth: null },
        { scope: "user", userId: maker.id, projects: null, judgedPerMonth: null },
        { scope: "clear", userId: maker.id },
      ]) {
        expect((await setLimits(body, headers)).status).toBe(404);
      }
    }
    world.signInAs(maker);
    const err = await page().catch((e: unknown) => e);
    expect(String((err as { digest?: string }).digest ?? err)).toContain("404");
    expect(await usageLimitsRepo.getDefault(world.db)).toBeNull();
    expect(await usageLimitsRepo.getForUser(world.db, maker.id)).toBeNull();
    expect(await adminAuditRepo.list(world.db)).toEqual([]);
  });

  it("AC-041-05 negative: bad numbers, unknown users and malformed bodies change nothing; each accepted change is audited with old and new numbers", async () => {
    world.signInAs(admin);
    for (const body of [
      { scope: "default", projects: -1, judgedPerMonth: 5 },
      { scope: "default", projects: 1.5, judgedPerMonth: 5 },
      { scope: "default", projects: 100_001, judgedPerMonth: 5 },
      { scope: "default", projects: "3", judgedPerMonth: 5 },
      { scope: "default", projects: 3 },
      { scope: "user", projects: 3, judgedPerMonth: 3 },
      { scope: "user", userId: "x'; drop table usage_limits;--", projects: 3, judgedPerMonth: 3 },
      { scope: "everyone", projects: 3, judgedPerMonth: 3 },
      { scope: "default", projects: 3, judgedPerMonth: 3, admin: true },
    ]) {
      expect((await setLimits(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(
      (
        await setLimits({
          scope: "user",
          email: "nobody@example.com",
          projects: 1,
          judgedPerMonth: 1,
        })
      ).status,
    ).toBe(404);
    expect(await usageLimitsRepo.getDefault(world.db)).toBeNull();
    expect(await adminAuditRepo.list(world.db)).toEqual([]);
    await setLimits({ scope: "default", projects: 4, judgedPerMonth: null });
    await setLimits({ scope: "user", userId: other.id, projects: 9, judgedPerMonth: 90 });
    const log = await adminAuditRepo.list(world.db);
    expect(log.map((r) => [r.action, r.targetId, r.detail])).toEqual([
      ["set_user_limits", other.id, "default -> projects 9, AI checks 90"],
      [
        "set_default_limits",
        "default",
        "projects 3, AI checks 100 -> projects 4, AI checks no limit",
      ],
    ]);
  });

  it("AC-041-06 boundary: before migration 0058 the built-in limits hold and the page says it is not set up", async () => {
    await world.db.execute(sql`DELETE FROM "_brain_migrations" WHERE id = '0058_usage_limits'`);
    resetMigrationCheckForTests();
    expect(await effectiveLimits(world.db, maker.id)).toEqual({
      projects: BETA.projects,
      judgedPerMonth: BETA.judgedPerMonth,
      source: "built-in",
    });
    world.signInAs(admin);
    expect(await page()).toContain('data-testid="limits-not-set-up"');
    expect((await setLimits({ scope: "default", projects: 50, judgedPerMonth: 50 })).status).toBe(
      409,
    );
    await fill(maker, BETA.projects);
    world.signInAs(maker);
    expect((await createProject("one too many")).status).toBe(402);
  });
});
