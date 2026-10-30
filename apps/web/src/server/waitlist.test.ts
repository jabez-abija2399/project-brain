import { createHash } from "node:crypto";
import WaitlistAdminPage from "@/app/admin/waitlist/page";
import { POST as joinRoute } from "@/app/api/waitlist/route";
import { joinWaitlist } from "@/components/landing/waitlist-form";
import { usersRepo, waitlistRepo } from "@brain/db";
import * as schema from "@brain/db/schema";
import { sql } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGithubLogin, setGithubLoginResolverForTests } from "./admin";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// Launch part 5: the landing page's waitlist saves emails; only owners listed in ADMIN_GITHUB_LOGINS can read them.
const APP = "https://codeceipts.test";
let world: TestWorld;

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  world = await createTestWorld();
  logins.clear();
  setGithubLoginResolverForTests(async (user) => logins.get(user.id) ?? null);
});
afterEach(async () => {
  setGithubLoginResolverForTests(null);
  vi.unstubAllEnvs();
  await world.teardown();
});

function join(email: unknown, ip = "203.0.113.7", headers: Record<string, string> = {}) {
  return joinRoute(
    new Request(`${APP}/api/waitlist`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        origin: APP,
        ...headers,
      },
      body: JSON.stringify({ email }),
    }),
  );
}

const emails = async () => (await waitlistRepo.list(world.db, {})).items.map((r) => r.email);

// The signed-in user's GitHub login is asked from GitHub with their own token; here a map stands in for GitHub.
const logins = new Map<string, string>();
async function signInWithLogin(login: string) {
  const user = await world.createUser({ name: login });
  logins.set(user.id, login);
  world.signInAs(user);
  return user;
}

const renderAdmin = async (page?: string) =>
  WaitlistAdminPage({ searchParams: Promise.resolve(page ? { page } : {}) }).then(
    (el) => renderToStaticMarkup(el as ReactElement),
    () => null,
  );

describe("waitlist", () => {
  it("saves a valid email once (trimmed, lowercased) and answers the same whether or not it was already there", async () => {
    const first = await join("  Ada@Example.COM ");
    const firstBody = await first.json();
    const again = await join("ada@example.com", "198.51.100.9");
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(await again.json()).toEqual(firstBody);
    expect(firstBody).toEqual({ ok: true });
    expect(await emails()).toEqual(["ada@example.com"]);
  });

  it("attack: invalid or oversized emails and junk bodies are refused and nothing is stored", async () => {
    for (const bad of [
      "",
      "you",
      "you@example",
      "a b@example.com",
      `${"x".repeat(250)}@e.com`,
      42,
      null,
      ["a@b.co"],
    ]) {
      // A new address each time: the per-address limit counts invalid tries too.
      const res = await join(bad, `198.51.100.${String(JSON.stringify(bad)).length}`);
      expect(res.status).toBe(400);
    }
    const junk = await joinRoute(
      new Request(`${APP}/api/waitlist`, {
        method: "POST",
        headers: { origin: APP },
        body: "not json",
      }),
    );
    expect(junk.status).toBe(400);
    expect(await emails()).toEqual([]);
  });

  it("attack: one address is rate limited per IP, other addresses are not, and the IP is never stored", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await join(`person${i}@example.com`)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await join("other@example.com", "198.51.100.20")).status).toBe(200);
    const keys = await world.db.execute(sql`select key from rate_counters`);
    const text = JSON.stringify(keys);
    expect(text).not.toContain("203.0.113.7");
    expect(text).toContain(createHash("sha256").update("203.0.113.7").digest("hex").slice(0, 32));
  });

  it("attack: a post from another site's page is refused", async () => {
    const res = await join("ada@example.com", "203.0.113.7", { origin: "https://evil.test" });
    expect(res.status).toBe(403);
    expect(await emails()).toEqual([]);
  });

  it("the landing form posts the email to /api/waitlist and shows the server's answer", async () => {
    const calls: { url: string; body: string }[] = [];
    const ok = await joinWaitlist(" you@example.com ", async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return Response.json({ ok: true });
    });
    expect(ok).toEqual({
      ok: true,
      message: "You're on the list. We'll email you when your invite is ready.",
    });
    expect(calls).toEqual([
      { url: "/api/waitlist", body: JSON.stringify({ email: "you@example.com" }) },
    ]);

    const limited = await joinWaitlist(
      "you@example.com",
      async () => new Response("{}", { status: 429 }),
    );
    expect(limited).toEqual({ ok: false, message: "Too many tries: wait a minute and try again." });
    const down = await joinWaitlist("you@example.com", async () => {
      throw new Error("offline");
    });
    expect(down).toEqual({ ok: false, message: "Could not reach the server. Try again." });
    let sent = false;
    const bad = await joinWaitlist("you@example", async () => {
      sent = true;
      return Response.json({ ok: true });
    });
    expect([bad.ok, sent]).toEqual([false, false]);
  });
});

describe("waitlist admin list", () => {
  it("asks GitHub for the login with the user's own token, and treats any failure as no login", async () => {
    const seen: { url: string; auth: string | null; redirect?: string }[] = [];
    const login = await fetchGithubLogin("gho_tok", async (url, init) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
        redirect: init?.redirect,
      });
      return Response.json({ login: "Ada", id: 7 });
    });
    expect(login).toBe("Ada");
    expect(seen).toEqual([
      { url: "https://api.github.com/user", auth: "Bearer gho_tok", redirect: "error" },
    ]);
    expect(
      await fetchGithubLogin("gho_tok", async () => new Response("{}", { status: 401 })),
    ).toBeNull();
    expect(await fetchGithubLogin("gho_tok", async () => Response.json({ login: 42 }))).toBeNull();
    expect(
      await fetchGithubLogin("gho_tok", async () => Response.json({ login: "a b<script>" })),
    ).toBeNull();
    expect(
      await fetchGithubLogin("gho_tok", async () => {
        throw new Error("down");
      }),
    ).toBeNull();
  });

  it("finds only the user's own GitHub account row to ask for its token", async () => {
    const ada = await world.createUser({ name: "ada" });
    const eve = await world.createUser({ name: "eve" });
    await world.db.insert(schema.accounts).values([
      { id: "acc-ada", userId: ada.id, accountId: "7", providerId: "github" },
      { id: "acc-eve", userId: eve.id, accountId: "8", providerId: "github" },
    ]);
    expect(await usersRepo.githubAccountId(world.db, ada.id)).toBe("acc-ada");
    expect(await usersRepo.githubAccountId(world.db, "nobody")).toBeNull();
  });

  it("an owner listed in ADMIN_GITHUB_LOGINS (any case) sees the emails, 50 per page", async () => {
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "someone, Ada ");
    for (let i = 0; i < 51; i++)
      await waitlistRepo.add(world.db, `p${String(i).padStart(2, "0")}@example.com`);
    await signInWithLogin("ada");
    const first = await renderAdmin();
    expect(first).toContain("Waitlist");
    expect(first).toContain("51 emails");
    expect(first?.match(/@example\.com/g)?.length).toBe(50);
    expect(first).toContain('href="/admin/waitlist?page=2"');
    const second = await renderAdmin("2");
    expect(second?.match(/@example\.com/g)?.length).toBe(1);
  });

  it("attack: signed-out visitors, other users, and everyone when ADMIN_GITHUB_LOGINS is unset get not found", async () => {
    await waitlistRepo.add(world.db, "secret@example.com");
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "ada");
    world.signInAs(null);
    expect(await renderAdmin()).toBeNull();
    await signInWithLogin("mallory");
    expect(await renderAdmin()).toBeNull();
    // A user without a stored login never matches, even an empty entry in the list.
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "ada,,");
    world.signInAs(await world.createUser({ name: "no-login" }));
    expect(await renderAdmin()).toBeNull();
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "");
    await signInWithLogin("ada");
    expect(await renderAdmin()).toBeNull();
  });
});
