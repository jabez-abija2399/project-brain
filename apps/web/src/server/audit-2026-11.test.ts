import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AccountLoading from "@/app/account/loading";
import AppError from "@/app/error";
import SelectRepoPage from "@/app/github/select/page";
import ProjectsLoading from "@/app/projects/loading";
import StartLoading from "@/app/start/loading";
import { FAQ } from "@/components/landing/content";
import { adminRepo, projectsRepo } from "@brain/db";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseDaily, reserveDaily } from "./rate-limit";
import { type TestWorld, createTestWorld } from "./test-helpers";

// docs/audit-2026-11.md: one test per HIGH and MEDIUM gap fixed in that audit.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
beforeEach(async () => {
  world = await createTestWorld();
});
afterEach(async () => {
  await world.teardown();
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

describe("audit 2026-11 fixes", () => {
  it("M-1: the GitHub repo picker sends a signed-out visitor to sign in instead of a broken picker", async () => {
    world.signInAs(null);
    expect(
      await digestOf(SelectRepoPage({ searchParams: Promise.resolve({ state: "x" }) })),
    ).toContain(";/sign-in");
  });

  it("M-2: every page has an error state, and the list pages outside projects have a loading state", () => {
    const app = fileURLToPath(new URL("../app", import.meta.url));
    expect(existsSync(`${app}/error.tsx`)).toBe(true);
    const err = renderToStaticMarkup(createElement(AppError, { reset: () => {} }));
    expect(err).toContain('role="alert"');
    expect(err).toContain("Try again");
    for (const L of [ProjectsLoading, StartLoading, AccountLoading]) {
      const html = renderToStaticMarkup(createElement(L));
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('<span class="lp-visually-hidden">Loading');
    }
  });

  it("M-3: AI calls are kept per project per day for the admin page; released calls are given back", async () => {
    const u = await world.createUser({ name: "ada" });
    const p = await projectsRepo.create(world.db, u.id, { name: "salon" });
    const now = new Date();
    expect(await reserveDaily(world.db, `ai:${p.id}`, 5, 3, now)).toBe(3);
    expect(await reserveDaily(world.db, `ai:${p.id}`, 5, 3, now)).toBe(2);
    await releaseDaily(world.db, `ai:${p.id}`, 1, now);
    // Other daily budgets (request capture) are not AI calls.
    await reserveDaily(world.db, `capture:${p.id}`, 5, 2, now);
    const usage = await adminRepo.aiUsage(world.db, now);
    expect(usage.rows.map((r) => [r.projectId, r.calls])).toEqual([[p.id, 4]]);
  });

  it("M-4: the landing FAQ points to the Account page for revoking keys and deleting the account", () => {
    const token = FAQ.find((f) => f.q === "What happens to my token?")?.a ?? "";
    const remove = FAQ.find((f) => f.q === "How do I remove it?")?.a ?? "";
    expect(token).toContain("Account page");
    expect(remove).toContain("delete your account");
  });
});
