import AccountPage from "@/app/account/page";
import { GET as exportRoute } from "@/app/api/account/export/route";
import { DELETE as deleteAccountRoute } from "@/app/api/account/route";
import { DELETE as endSessionsRoute } from "@/app/api/account/sessions/route";
import { GET as whoami } from "@/app/api/token/whoami/route";
import SignInPage from "@/app/sign-in/page";
import { confirmMatches } from "@/lib/ui-helpers";
import { safeNextPath } from "@/lib/safe-path";
import {
  adminRepo,
  projectTokensRepo,
  projectsRepo,
  receiptsRepo,
  usersRepo,
  waitlistRepo,
} from "@brain/db";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { sessionSafety } from "./auth";
import { pageUser, signInHref } from "./dashboard-page";
import { verifyProjectToken } from "./mcp-tools";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Sign-in, sign-out and the account page (2026-11-01).
let path: string | null = null;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(path ? { "x-codeceipt-path": path } : {}),
}));

const APP = "https://codeceipts.test";
let world: TestWorld;
let owner: SessionUser;

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  world = await createTestWorld();
  owner = await world.createUser({ name: "Ada Lovelace" });
  world.signInAs(owner);
  path = null;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await world.teardown();
});

const req = (method: string, url: string, body?: unknown, origin: string | null = APP) =>
  new Request(`${APP}${url}`, {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const digestOf = async (p: Promise<unknown>) =>
  String(
    (
      (await p.then(
        () => null,
        (e: unknown) => e,
      )) as { digest?: string } | null
    )?.digest,
  );
const count = async (table: string) =>
  Number(
    (
      (await world.db.execute(`select count(*)::int as n from "${table}"` as never)) as unknown as {
        rows: { n: number }[];
      }
    ).rows[0]?.n,
  );

describe("sign-in and the return path", () => {
  it("attack: only same-site paths survive; anything that could leave the site goes to /projects", () => {
    expect(safeNextPath("/projects/abc/receipts?page=2")).toBe("/projects/abc/receipts?page=2");
    expect(safeNextPath("/device?code=BCDF-GHJK")).toBe("/device?code=BCDF-GHJK");
    for (const bad of [
      "https://evil.example/",
      "//evil.example/x",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "/%2F%2Fevil.example",
      "/sign-in?next=/x",
      "/x\u0000y",
      "/x\ny",
      `/${"a".repeat(400)}`,
      "",
      undefined,
      ["/a"],
    ]) {
      expect([bad, safeNextPath(bad)]).toEqual([bad, "/projects"]);
    }
  });

  it("the sign-in page: one GitHub button, what it reads and why, Privacy and Terms, and a safe way back", async () => {
    world.signInAs(null);
    const html = renderToStaticMarkup(
      (await SignInPage({
        searchParams: Promise.resolve({ next: "//evil.example" }),
      })) as ReactElement,
    );
    expect(html.match(/Sign in with GitHub/g)).toHaveLength(1);
    expect(html).toContain("What Codeceipt reads from GitHub");
    expect(html).toContain("No repository access.");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });

  it("signed in, the sign-in page goes straight to the page asked for (and never off the site)", async () => {
    const go = (next: string) => digestOf(SignInPage({ searchParams: Promise.resolve({ next }) }));
    expect(await go("/projects/p1/receipts")).toContain(";/projects/p1/receipts;");
    expect(await go("https://evil.example")).toContain(";/projects;");
  });

  it("a signed-out visitor to a dashboard page is sent to sign in, with the page to come back to", async () => {
    world.signInAs(null);
    path = "/projects/p1/receipts?page=2";
    expect(await digestOf(pageUser())).toContain(
      `;/sign-in?next=${encodeURIComponent("/projects/p1/receipts?page=2")};`,
    );
    path = "//evil.example";
    expect(await digestOf(pageUser())).toContain(";/sign-in;");
    expect(signInHref(null)).toBe("/sign-in");
  });

  it("sessions expire after 7 days and the cookie is httpOnly, sameSite=lax and secure in production", () => {
    const prod = sessionSafety({ NODE_ENV: "production" });
    expect(prod.session.expiresIn).toBe(7 * 24 * 60 * 60);
    expect(prod.advanced).toEqual({
      useSecureCookies: true,
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax" },
    });
    expect(sessionSafety({ BETTER_AUTH_URL: "https://x.example" }).advanced.useSecureCookies).toBe(
      true,
    );
    expect(
      sessionSafety({ BETTER_AUTH_URL: "http://localhost:3000" }).advanced.useSecureCookies,
    ).toBe(false);
  });
});

describe("account page", () => {
  it("shows the GitHub name, connected computers with revoke, sign out everywhere, export and delete", async () => {
    const p = await projectsRepo.create(world.db, owner.id, { name: "salon" });
    await projectTokensRepo.create(world.db, p.id, "salon-booking");
    const html = renderToStaticMarkup((await AccountPage()) as ReactElement);
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("salon-booking");
    expect(html).toContain('aria-label="Revoke the key for salon-booking"');
    expect(html).toContain("Sign out of all sessions");
    expect(html).toContain('href="/api/account/export"');
    expect(html).toContain("Delete my account forever");
    expect(html).toContain('href="/privacy#deleting-your-data"');
    expect(html).not.toMatch(/pb_[\w-]{10}/);
  });

  it("the delete button waits for the exact account name", () => {
    expect(confirmMatches("", "Ada")).toBe(false);
    expect(confirmMatches("ada", "Ada")).toBe(false);
    expect(confirmMatches(" Ada ", "Ada")).toBe(true);
  });
});

describe("account actions", () => {
  it("sign out of all sessions ends every session of this user only", async () => {
    const other = await world.createUser({ name: "eve" });
    for (const [id, u] of [
      ["s1", owner.id],
      ["s2", owner.id],
      ["s3", other.id],
    ]) {
      await world.db.execute(
        `insert into "session" (id, "userId", token, "expiresAt") values ('${id}', '${u}', '${id}', now() + interval '1 day')` as never,
      );
    }
    const res = await endSessionsRoute(req("DELETE", "/api/account/sessions"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ended: 2 });
    expect(await count("session")).toBe(1);
  });

  it("export: a JSON download of the user's own data, never tokens or hashes, never cached", async () => {
    const p = await projectsRepo.create(world.db, owner.id, { name: "salon" });
    const { token, row } = await projectTokensRepo.create(world.db, p.id, "laptop");
    await receiptsRepo.insert(world.db, p.id, { requestId: null, summaryJson: { items: [] } });
    const other = await world.createUser({ name: "eve" });
    await projectsRepo.create(world.db, other.id, { name: "eve-secret-app" });
    const res = await exportRoute(req("GET", "/api/account/export", undefined, null));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="codeceipt-export-/,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const data = JSON.parse(text);
    expect(data.format).toBe("codeceipt-export-1");
    expect(data.projects.map((x: { name: string }) => x.name)).toEqual(["salon"]);
    expect(data.projects[0].receipts).toHaveLength(1);
    expect(text).not.toContain(token);
    expect(text).not.toContain(row.hash);
    expect(text).not.toContain("eve-secret-app");
  });

  it("delete: refuses a wrong name, then deletes the account, its projects and data, and the waitlist entry", async () => {
    const p = await projectsRepo.create(world.db, owner.id, { name: "salon" });
    await receiptsRepo.insert(world.db, p.id, { requestId: null, summaryJson: {} });
    await waitlistRepo.add(world.db, owner.email.toLowerCase());
    const other = await world.createUser({ name: "eve" });
    const theirs = await projectsRepo.create(world.db, other.id, { name: "theirs" });

    const wrong = await deleteAccountRoute(
      req("DELETE", "/api/account", { confirm: "ada lovelace" }),
    );
    expect(wrong.status).toBe(400);
    expect(await usersRepo.getById(world.db, owner.id)).not.toBeNull();

    const ok = await deleteAccountRoute(req("DELETE", "/api/account", { confirm: "Ada Lovelace" }));
    expect(ok.status).toBe(200);
    expect(await usersRepo.getById(world.db, owner.id)).toBeNull();
    expect(await projectsRepo.get(world.db, p.id, owner.id)).toBeNull();
    expect(await count("waitlist")).toBe(0);
    expect(await projectsRepo.get(world.db, theirs.id, other.id)).not.toBeNull();
  });

  it("attack: account actions need the app's own origin and a signed-in user; ids from the client are ignored", async () => {
    const evil = await deleteAccountRoute(
      req("DELETE", "/api/account", { confirm: "Ada Lovelace" }, "https://evil.example"),
    );
    expect(evil.status).toBe(403);
    expect(
      (
        await endSessionsRoute(
          req("DELETE", "/api/account/sessions", undefined, "https://evil.example"),
        )
      ).status,
    ).toBe(403);
    // Extra fields (another user's id) are refused, not used.
    const other = await world.createUser({ name: "eve" });
    const extra = await deleteAccountRoute(
      req("DELETE", "/api/account", { confirm: "eve", userId: other.id }),
    );
    expect(extra.status).toBe(400);
    expect(await usersRepo.getById(world.db, other.id)).not.toBeNull();
    world.signInAs(null);
    expect((await exportRoute(req("GET", "/api/account/export"))).status).toBe(401);
    expect((await deleteAccountRoute(req("DELETE", "/api/account", { confirm: "x" }))).status).toBe(
      401,
    );
  });
});

describe("suspension", () => {
  it("a suspended user: pages go to /suspended, the API says suspended, the account page and its actions still work", async () => {
    await adminRepo.setUserSuspended(world.db, owner.id, true);
    expect(await digestOf(pageUser())).toContain(";/suspended;");
    const { POST: createProject } = await import("@/app/api/projects/route");
    const res = await createProject(req("POST", "/api/projects", { name: "x" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: "suspended",
      message: expect.stringMatching(/suspended/),
    });
    expect(renderToStaticMarkup((await AccountPage()) as ReactElement)).toContain(
      "Your account is suspended.",
    );
    expect((await exportRoute(req("GET", "/api/account/export"))).status).toBe(200);
  });

  it("a suspended project's (or suspended owner's) token gets 403 suspended on the API and a suspended answer on MCP", async () => {
    const p = await projectsRepo.create(world.db, owner.id, { name: "salon" });
    const { token } = await projectTokensRepo.create(world.db, p.id, null);
    const call = () =>
      whoami(
        new Request(`${APP}/api/token/whoami`, { headers: { authorization: `Bearer ${token}` } }),
      );
    expect((await call()).status).toBe(200);
    await adminRepo.setProjectSuspended(world.db, p.id, true);
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("suspended");
    expect((await verifyProjectToken(new Request(APP), token))?.extra?.suspended).toBe("project");
    await adminRepo.setProjectSuspended(world.db, p.id, false);
    await adminRepo.setUserSuspended(world.db, owner.id, true);
    expect((await call()).status).toBe(403);
    expect((await verifyProjectToken(new Request(APP), token))?.extra?.suspended).toBe("user");
  });
});
