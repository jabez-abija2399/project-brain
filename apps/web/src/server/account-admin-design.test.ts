// FEAT-037: Account, connection keys, Admin and Suspended. The plan card with usage, one name for keys with a
// copy-once secret, signed-in browsers with "This browser", sign-out-everywhere that asks first, suspend that states
// its consequences and keeps a reason, and an admin overview that leads with a sentence. Every admin page and action
// stays 404 for anyone else (attacker test).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AccountPage from "@/app/account/page";
import AdminAiPage from "@/app/admin/ai/page";
import AdminAuditPage from "@/app/admin/audit/page";
import AdminPage from "@/app/admin/page";
import AdminUsersPage from "@/app/admin/users/page";
import { POST as suspendRoute } from "@/app/api/admin/suspend/route";
import { adminAuditRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGithubLoginResolverForTests } from "./admin";
import { type SessionUser, setSessionIdResolverForTests } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}));

const SRC = join(__dirname, "..");
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
  const logins = new Map([
    [ada.id, "ada-gh"],
    [eve.id, "eve-gh"],
  ]);
  setGithubLoginResolverForTests(async (u) => logins.get(u.id) ?? null);
  world.signInAs(ada);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setGithubLoginResolverForTests(null);
  setSessionIdResolverForTests(null);
  await world.teardown();
});

const html = async (el: unknown) => renderToStaticMarkup((await el) as ReactElement);
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
async function addSession(id: string, userId: string) {
  await world.db.execute(
    `insert into "session" (id, "userId", token, "expiresAt", "userAgent") values ('${id}', '${userId}', 'tok-${id}', now() + interval '1 day', null)` as never,
  );
}
const suspend = (body: object) =>
  suspendRoute(
    new Request(`${APP}/api/admin/suspend`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP },
      body: JSON.stringify(body),
    }),
  );

describe("FEAT-037 account and admin", () => {
  it("AC-037-01 Account: a plan card with usage, Connection keys with a copy-once secret, Signed-in browsers marking This browser", async () => {
    vi.stubEnv("BETA_LIMITS", "on");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    await addSession("s-other", ada.id);
    await addSession("s-here", ada.id);
    setSessionIdResolverForTests(async () => "s-here");
    const page = await html(AccountPage());
    const t = text(page);
    expect(page).toContain('data-testid="plan-card"');
    expect(t).toContain("Free beta: 0 of 3 projects, 0 of 100 AI-checked receipts this month");
    expect(page).toContain(">Connection keys</h2>");
    expect(page).toContain(">Signed-in browsers</h2>");
    expect(page.match(/data-testid="this-browser"/g)).toHaveLength(1);
    // "This browser" is listed first.
    expect(page.indexOf('data-testid="this-browser"')).toBeLessThan(
      page.indexOf("Sign out Unknown"),
    );
    const panel = readFileSync(join(SRC, "app/projects/[id]/tokens-panel.tsx"), "utf8");
    expect(panel).toContain('<CopyButton label="Copy key" text={plaintext} />');
  });

  it("AC-037-02 suspending states the consequences, keeps an optional reason in the audit log, uses danger style; the admin overview leads with a sentence", async () => {
    const button = readFileSync(join(SRC, "components/admin/suspend-button.tsx"), "utf8");
    expect(button).toContain(
      "Their dashboard, CLI and agents stop working right away and they see the Suspended page.",
    );
    expect(button).toContain('"btn-danger"');
    expect(button).toContain("Reason (optional, kept in the audit log)");
    const res = await suspend({
      targetType: "user",
      targetId: eve.id,
      suspended: true,
      reason: "Spam projects",
    });
    expect(res.status).toBe(200);
    const [row] = await adminAuditRepo.list(world.db);
    expect(row?.detail).toBe("Spam projects");
    expect(text(await html(AdminAuditPage()))).toContain("Spam projects");
    const overview = await html(AdminPage());
    expect(overview).toContain('data-testid="admin-status"');
    expect(text(overview)).toMatch(/(All systems OK|Needs setup: [a-zA-Z ,]+) · 1 suspended/);
  });

  it("AC-037-03 permission: every admin page and action answers 404 to a non-admin", async () => {
    world.signInAs(eve);
    for (const page of [AdminPage, AdminUsersPage, AdminAiPage, AdminAuditPage]) {
      const err = await html(
        (page as (p: unknown) => Promise<unknown>)({ searchParams: Promise.resolve({}) }),
      ).catch((e: unknown) => e);
      expect(String((err as { digest?: string }).digest ?? err)).toContain("404");
    }
    const res = await suspend({ targetType: "user", targetId: ada.id, suspended: true });
    expect(res.status).toBe(404);
    expect(await adminAuditRepo.list(world.db)).toEqual([]);
  });

  it("AC-037-04 negative: 'Sign out everywhere' asks 'including this browser?' before acting", () => {
    const source = readFileSync(join(SRC, "components/account/sign-out-everywhere.tsx"), "utf8");
    expect(source).toContain('title: "Sign out everywhere, including this browser?"');
    // The request is only sent after the dialog says yes.
    expect(source.indexOf("await ask(")).toBeLessThan(
      source.indexOf('fetch("/api/account/sessions"'),
    );
    expect(source).toMatch(/if \(\s*!\(await ask\(/);
  });
});
