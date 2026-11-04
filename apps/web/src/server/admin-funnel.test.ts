// FEAT-026: the activation funnel on the admin overview, per week of sign-up. Admins only; one aggregate query.
import AdminPage from "@/app/admin/page";
import { projects, receipts, users } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGithubLoginResolverForTests } from "./admin";
import { adminFunnel } from "./admin-data";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const APP = "https://codeceipts.test";
const ADMIN = { login: "ada-gh" } as Parameters<typeof adminFunnel>[0];
let world: TestWorld;
let ada: SessionUser;
let eve: SessionUser;

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  vi.stubEnv("ADMIN_GITHUB_LOGINS", "ada-gh");
  world = await createTestWorld();
  ada = await world.createUser({ name: "Ada" });
  eve = await world.createUser({ name: "Eve" });
  setGithubLoginResolverForTests(async (u) => (u.id === ada.id ? "ada-gh" : "eve-gh"));
});
afterEach(async () => {
  setGithubLoginResolverForTests(null);
  vi.unstubAllEnvs();
  await world.teardown();
});

const NOW = new Date("2026-11-04T12:00:00Z"); // a Wednesday; its week starts Monday 2026-11-02
const at = (iso: string) => new Date(iso);
async function signUp(id: string, createdAt: Date) {
  await world.db.insert(users).values({ id, name: id, email: `${id}@example.com`, createdAt });
}
async function project(id: string, ownerId: string, linked: boolean) {
  await world.db.insert(projects).values({
    id,
    ownerId,
    name: id,
    ...(linked ? { repoFingerprint: "r=abc;o=def" } : {}),
  });
}
async function receipt(projectId: string, createdAt: Date, summaryJson: unknown) {
  await world.db.insert(receipts).values({ projectId, createdAt, summaryJson });
}

describe("FEAT-026 activation funnel", () => {
  it("AC-026-01 per week of sign-up: signed up, linked a repo, first receipt, caught something, first receipt within 10 minutes", async () => {
    // Keep the two users from beforeEach out of these weeks.
    await world.db.update(users).set({ createdAt: at("2025-01-01T00:00:00Z") });
    // This week: fast and caught a secret; linked but no receipt; signed up only.
    await signUp("u1", at("2026-11-03T09:00:00Z"));
    await project("p1", "u1", true);
    await receipt("p1", at("2026-11-03T09:06:00Z"), {
      findings: [{ type: "stripe_secret_key" }],
    });
    await signUp("u2", at("2026-11-02T10:00:00Z"));
    await project("p2", "u2", true);
    await signUp("u3", at("2026-11-04T08:00:00Z"));
    // Last week: a weakened test caught, but the first receipt came after an hour.
    await signUp("u4", at("2026-10-28T09:00:00Z"));
    await project("p4", "u4", true);
    await receipt("p4", at("2026-10-28T10:00:00Z"), {
      findings: [],
      test_integrity: { flags: [{}] },
    });
    // Older than 12 weeks: left out.
    await signUp("u5", at("2026-07-01T09:00:00Z"));

    const weeks = await adminFunnel(ADMIN, world.db, NOW);
    expect(weeks).toEqual([
      { week: "2026-11-02", signedUp: 3, linked: 2, firstReceipt: 1, caught: 1, fast: 1 },
      { week: "2026-10-26", signedUp: 1, linked: 1, firstReceipt: 1, caught: 1, fast: 0 },
    ]);

    world.signInAs(ada);
    const html = renderToStaticMarkup((await AdminPage()) as ReactElement);
    expect(html).toContain("Activation, by week of sign-up");
    expect(html).toContain("Caught something");
  });

  it("AC-026-02 permission: only admins see the funnel; others get the 404 page", async () => {
    world.signInAs(eve);
    const err = (await AdminPage().then(
      () => null,
      (e: unknown) => e,
    )) as { digest?: string } | null;
    expect(String(err?.digest)).toMatch(/404/);
    world.signInAs(null);
    const anon = (await AdminPage().then(
      () => null,
      (e: unknown) => e,
    )) as { digest?: string } | null;
    expect(String(anon?.digest)).toMatch(/404/);
  });

  it("AC-026-03 boundary: 12 weeks with 10,000 users load in under 1 s (one aggregate query)", async () => {
    await world.db.update(users).set({ createdAt: new Date("2025-01-01T00:00:00Z") });
    const start = NOW.getTime() - 70 * 86_400_000;
    const ids = Array.from({ length: 10_000 }, (_, i) => `load-${i}`);
    for (let i = 0; i < ids.length; i += 1000) {
      await world.db.insert(users).values(
        ids.slice(i, i + 1000).map((id, j) => ({
          id,
          name: id,
          email: `${id}@example.com`,
          createdAt: new Date(start + (i + j) * 600_000),
        })),
      );
      await world.db.insert(projects).values(
        ids.slice(i, i + 1000).map((id, j) => ({
          id: `p-${id}`,
          ownerId: id,
          name: id,
          ...((i + j) % 2 ? { repoFingerprint: "r=a;o=b" } : {}),
        })),
      );
      await world.db.insert(receipts).values(
        ids
          .slice(i, i + 1000)
          .filter((_, j) => (i + j) % 3 === 0)
          .map((id, j) => ({
            projectId: `p-${id}`,
            createdAt: new Date(start + (i + j * 3) * 600_000 + 300_000),
            summaryJson: { findings: (i + j) % 2 ? [{ type: "x" }] : [] },
          })),
      );
    }
    const statements: string[] = [];
    const original = world.db.execute.bind(world.db);
    const counted = Object.assign(Object.create(world.db), {
      execute: (q: Parameters<typeof original>[0]) => {
        statements.push("execute");
        return original(q);
      },
      select: () => {
        statements.push("select");
        return world.db.select();
      },
    }) as typeof world.db;
    const t0 = performance.now();
    const weeks = await adminFunnel(ADMIN, counted, NOW);
    const ms = performance.now() - t0;
    expect(statements).toHaveLength(1);
    expect(weeks.reduce((n, w) => n + w.signedUp, 0)).toBe(10_000);
    expect(ms).toBeLessThan(1000);
  });
});
