import AdminAiPage from "@/app/admin/ai/page";
import AdminAuditPage from "@/app/admin/audit/page";
import AdminPage from "@/app/admin/page";
import AdminUserPage from "@/app/admin/users/[id]/page";
import AdminUsersPage from "@/app/admin/users/page";
import WaitlistAdminPage from "@/app/admin/waitlist/page";
import { POST as suspendRoute } from "@/app/api/admin/suspend/route";
import { GET as csvRoute } from "@/app/api/admin/waitlist/route";
import {
  adminAuditRepo,
  aiUsageRepo,
  projectTokensRepo,
  projectsRepo,
  receiptsRepo,
  usersRepo,
  waitlistRepo,
} from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGithubLoginResolverForTests } from "./admin";
import { csvCell } from "./admin-data";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

// The admin section (2026-11-01): only GitHub logins in ADMIN_GITHUB_LOGINS, checked on the server for every page and
// action; everyone else gets the normal 404. Counts only, never receipt contents or token values.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const APP = "https://codeceipts.test";
let world: TestWorld;
let ada: SessionUser;
let eve: SessionUser;

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  vi.stubEnv("ADMIN_GITHUB_LOGINS", "ada-gh");
  world = await createTestWorld();
  ada = await world.createUser({ name: "Ada" });
  eve = await world.createUser({ name: "Eve" });
  // The login comes from GitHub (with the user's own token) in production; here, by user id.
  setGithubLoginResolverForTests(async (u) => (u.id === ada.id ? "ada-gh" : "eve-gh"));
  world.signInAs(ada);
});
afterEach(async () => {
  setGithubLoginResolverForTests(null);
  vi.unstubAllEnvs();
  await world.teardown();
});

const html = async (p: Promise<unknown>) => renderToStaticMarkup((await p) as ReactElement);
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const digestOf = async (p: Promise<unknown>) =>
  String(
    (
      (await p.then(
        () => null,
        (e: unknown) => e,
      )) as { digest?: string } | null
    )?.digest,
  );
const post = (body: unknown, origin = APP) =>
  new Request(`${APP}/api/admin/suspend`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const pages = () => [
  AdminPage(),
  AdminUsersPage({ searchParams: Promise.resolve({}) }),
  AdminUserPage({ params: Promise.resolve({ id: eve.id }) }),
  AdminAiPage(),
  AdminAuditPage(),
  WaitlistAdminPage({ searchParams: Promise.resolve({}) }),
];

describe("admin access", () => {
  it("attack: another user, a signed-out visitor, and everyone when ADMIN_GITHUB_LOGINS is unset get the 404 page", async () => {
    for (const setup of [
      () => world.signInAs(eve),
      () => world.signInAs(null),
      () => {
        world.signInAs(ada);
        vi.stubEnv("ADMIN_GITHUB_LOGINS", "");
      },
    ]) {
      setup();
      for (const p of pages()) expect(await digestOf(p)).toMatch(/404/);
      const res = await suspendRoute(
        post({ targetType: "user", targetId: eve.id, suspended: true }),
      );
      expect([401, 404]).toContain(res.status);
      expect([401, 404]).toContain(
        (await csvRoute(new Request(`${APP}/api/admin/waitlist`))).status,
      );
    }
    expect((await usersRepo.getById(world.db, eve.id))?.suspendedAt).toBeNull();
  });

  it("attack: a renamed display name never makes an admin (only the GitHub login counts)", async () => {
    await world.db.execute(`update "user" set name = 'ada-gh' where id = '${eve.id}'` as never);
    world.signInAs({ ...eve, name: "ada-gh" });
    expect(await digestOf(AdminPage())).toMatch(/404/);
  });
});

describe("admin pages", () => {
  it("overview: users, projects, receipts per day, active projects, waitlist and health", async () => {
    const p = await projectsRepo.create(world.db, eve.id, { name: "salon" });
    await receiptsRepo.insert(world.db, p.id, { requestId: null, summaryJson: {} });
    await waitlistRepo.add(world.db, "w@example.com");
    const t = text(await html(AdminPage()));
    expect(t).toContain("Signed in as ada-gh");
    expect(t).toMatch(/Users 2/);
    expect(t).toMatch(/Projects 1/);
    expect(t).toMatch(/Active projects, 7 days 1/);
    expect(t).toMatch(/Waitlist 1/);
    expect(t).toContain("Database answers");
    expect(t).toContain("1 receipts in 30 days");
  });

  it("users: list with counts and search; a user's page shows projects and receipt counts, never contents or tokens", async () => {
    const p = await projectsRepo.create(world.db, eve.id, { name: "salon" });
    await receiptsRepo.insert(world.db, p.id, {
      requestId: null,
      summaryJson: {
        items: [{ id: "a", text: "SECRET-RECEIPT-TEXT", status: "done", evidence: [] }],
      },
    });
    const { token, row } = await projectTokensRepo.create(world.db, p.id, "laptop");
    const list = text(await html(AdminUsersPage({ searchParams: Promise.resolve({ q: "eve" }) })));
    expect(list).toContain("Eve");
    expect(list).not.toContain("Ada ");
    const detail = await html(AdminUserPage({ params: Promise.resolve({ id: eve.id }) }));
    expect(text(detail)).toContain("salon");
    expect(detail).not.toContain("SECRET-RECEIPT-TEXT");
    expect(detail).not.toContain(token);
    expect(detail).not.toContain(row.hash);
    expect(detail).toContain('aria-label="Suspend user Eve"');
    // An unknown or malformed id is the 404 page.
    expect(await digestOf(AdminUserPage({ params: Promise.resolve({ id: "nope" }) }))).toMatch(
      /404/,
    );
    expect(await digestOf(AdminUserPage({ params: Promise.resolve({ id: "../x" }) }))).toMatch(
      /404/,
    );
  });

  it("AI usage: calls and estimated cost per day and per project, and the projects that hit the daily budget", async () => {
    vi.stubEnv("AI_CALLS_PER_PROJECT_PER_DAY", "10");
    vi.stubEnv("AI_COST_PER_CALL_USD", "0.01");
    const busy = await projectsRepo.create(world.db, eve.id, { name: "busy" });
    const calm = await projectsRepo.create(world.db, eve.id, { name: "calm" });
    await aiUsageRepo.add(world.db, busy.id, new Date(), 10);
    await aiUsageRepo.add(world.db, calm.id, new Date(), 3);
    const t = text(await html(AdminAiPage()));
    expect(t).toContain("Each project may make 10 AI calls a day");
    expect(t).toMatch(/AI calls, 30 days 13/);
    expect(t).toMatch(/Estimated cost, 30 days \$0\.13/);
    expect(t).toMatch(/Projects that hit the budget 1/);
    expect(t).toContain("busy 10 $0.10 10 of 10 ! Hit on 1 day");
    expect(t).toContain("calm 3 $0.03 3 of 10 ✓ Within budget");
  });
});

describe("admin actions", () => {
  it("suspend and restore a user and a project, each recorded in the audit log", async () => {
    const p = await projectsRepo.create(world.db, eve.id, { name: "salon" });
    for (const body of [
      { targetType: "user", targetId: eve.id, suspended: true },
      { targetType: "project", targetId: p.id, suspended: true },
      { targetType: "user", targetId: eve.id, suspended: false },
    ]) {
      expect((await suspendRoute(post(body))).status).toBe(200);
    }
    expect((await usersRepo.getById(world.db, eve.id))?.suspendedAt).toBeNull();
    expect((await projectsRepo.get(world.db, p.id, eve.id))?.suspendedAt).toBeInstanceOf(Date);
    const log = await adminAuditRepo.list(world.db);
    expect(log.map((l) => [l.adminLogin, l.action, l.targetId])).toEqual([
      ["ada-gh", "unsuspend_user", eve.id],
      ["ada-gh", "suspend_project", p.id],
      ["ada-gh", "suspend_user", eve.id],
    ]);
    const audit = text(await html(AdminAuditPage()));
    expect(audit).toContain("suspend project");
    expect(audit).not.toContain("Edit");
  });

  it("attack: bad input, unknown targets, suspending yourself and other origins are refused (and not logged)", async () => {
    expect((await suspendRoute(post({ targetType: "user", targetId: eve.id }))).status).toBe(400);
    expect(
      (await suspendRoute(post({ targetType: "team", targetId: eve.id, suspended: true }))).status,
    ).toBe(400);
    expect(
      (await suspendRoute(post({ targetType: "user", targetId: "nobody", suspended: true })))
        .status,
    ).toBe(404);
    const self = await suspendRoute(
      post({ targetType: "user", targetId: ada.id, suspended: true }),
    );
    expect(self.status).toBe(400);
    expect((await self.json()).code).toBe("cannot_suspend_self");
    const evil = await suspendRoute(
      post({ targetType: "user", targetId: eve.id, suspended: true }, "https://evil.example"),
    );
    expect(evil.status).toBe(403);
    expect(await adminAuditRepo.list(world.db)).toEqual([]);
  });

  it("waitlist: the page links a CSV export; the CSV defuses formulas and the export is logged", async () => {
    await waitlistRepo.add(world.db, "a@example.com");
    await waitlistRepo.add(world.db, "=cmd@example.com");
    expect(await html(WaitlistAdminPage({ searchParams: Promise.resolve({}) }))).toContain(
      'href="/api/admin/waitlist"',
    );
    const res = await csvRoute(new Request(`${APP}/api/admin/waitlist`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toBe("email,joined");
    expect(csv).toContain('"a@example.com"');
    expect(csv).toContain(`"'=cmd@example.com"`);
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect((await adminAuditRepo.list(world.db))[0]).toMatchObject({
      action: "export_waitlist",
      detail: "2 rows",
    });
  });
});
