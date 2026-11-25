// FEAT-027: the free beta. With BETA_LIMITS=on and Stripe not set, every account gets 3 projects and 100 AI-checked
// receipts a month; the pages say the same thing. Attacker tests are named "attack: ...".
import { POST as createProjectRoute } from "@/app/api/projects/route";
import { BetaPricingBody } from "@/components/pricing-body";
import { BETA, BETA_SUMMARY, type Llm, receiptView } from "@brain/core";
import { projectTokensRepo, projectsRepo, receipts, requestsRepo } from "@brain/db";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountView } from "./account";
import type { SessionUser } from "./auth";
import { BETA_PROJECT_LIMIT_MESSAGE, betaLimitsOn, judgeAllowed } from "./billing";
import { approveDevice, startDevice } from "./device";
import { setLlmForTests } from "./llm";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

const ORIGIN = "https://codeceipt.example.com";
let world: TestWorld;
let user: SessionUser;

beforeEach(async () => {
  world = await createTestWorld();
  user = await world.createUser({ name: "maker" });
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("BETA_LIMITS", "on");
  vi.stubEnv("BETTER_AUTH_URL", ORIGIN);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setLlmForTests(undefined);
  await world.teardown();
});

const createProject = (name: string, body: Record<string, unknown> = {}) =>
  createProjectRoute(
    new Request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ name, ...body }),
    }),
  );

async function deviceCode(): Promise<string> {
  const req = new Request(`${ORIGIN}/api/device/start`, {
    method: "POST",
    headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` },
  });
  return (await startDevice(world.db, req, { name: "app" })).user_code;
}

const owned = async (id: string) =>
  (await projectsRepo.listByOwner(world.db, id, { limit: 10, offset: 0 })).items.length;

async function receiptFor(pid: string) {
  const token = (await projectTokensRepo.create(world.db, pid)).row;
  const { request } = await requestsRepo.createWithItems(
    world.db,
    pid,
    { featureId: null, text: "Add a footer" },
    [{ text: "Add a footer", needsClarification: false }],
  );
  const made = await generateReceipt(world.db, token, {
    projectId: pid,
    requestId: request.id,
    changedFiles: ["src/a.ts"],
  });
  const [row] = await world.db
    .select()
    .from(receipts)
    .where(eq(receipts.id, String(made.receipt_id)));
  return receiptView(row?.summaryJson);
}

describe("FEAT-027 free beta with limits", () => {
  it("AC-027-01 3 projects are allowed; a 4th from the dashboard or /device returns 402 with the beta message", async () => {
    world.signInAs(user);
    for (const name of ["one", "two", "three"])
      expect((await createProject(name)).status).toBe(201);
    const fourth = await createProject("four");
    expect(fourth.status).toBe(402);
    expect(((await fourth.json()) as { message: string }).message).toBe(
      "The free beta includes 3 projects. Delete one or wait for paid plans.",
    );
    expect(BETA_PROJECT_LIMIT_MESSAGE).toContain(`${BETA.projects} projects`);
    await expect(
      approveDevice(world.db, user, { user_code: await deviceCode(), new_project_name: "five" }),
    ).rejects.toMatchObject({ status: 402, code: "plan_limit" });
    expect(await owned(user.id)).toBe(3);
  });

  it("AC-027-02 the 100th receipt of the month is AI-checked; the 101st is made from git and says the beta limit is used", async () => {
    const pid = (await projectsRepo.create(world.db, user.id, { name: "app" })).id;
    for (let i = 0; i < 99; i++) expect(await judgeAllowed(world.db, pid)).toBe(true);
    let judged = 0;
    const llm: Llm = {
      async complete() {
        judged++;
        return "1 | done | src/a.ts";
      },
    };
    setLlmForTests(llm);
    const hundredth = await receiptFor(pid);
    expect(judged).toBe(1);
    expect(hundredth.judgeSkipped).toBe(false);

    const next = await receiptFor(pid);
    expect(judged).toBe(1);
    expect(next.judgeSkipped).toBe(true);
    expect(next.judgeSkippedBy).toBe("beta_limit");
    expect(next.items.map((i) => i.status)).toEqual(["not_verified"]);
    // A new month starts again.
    expect(await judgeAllowed(world.db, pid, new Date(Date.now() + 40 * 86400_000))).toBe(true);
  });

  it("AC-027-03 pricing, landing FAQ and terms say free during the beta with the same limits; no price or checkout", async () => {
    const html = renderToStaticMarkup(createElement(BetaPricingBody, { signedIn: false }));
    expect(html).toContain("free during the beta");
    expect(html).toContain(`${BETA.projects} projects`);
    expect(html).toContain(`${BETA.judgedPerMonth} AI-checked receipts a month`);
    expect(html).not.toMatch(/\$\d|checkout|Choose (Builder|Pro|Agency)|founding/i);
    expect(BETA_SUMMARY).toBe(
      "Free during the beta: 3 projects and 100 AI-checked receipts a month.",
    );
    const { FAQ } = await import("@/components/landing/content");
    const cost = FAQ.find((f) => f.q === "What does it cost?");
    expect(cost?.a).toContain(BETA_SUMMARY);
    const { SiteHeader } = await import("@/components/landing/site-header");
    const { SiteFooter } = await import("@/components/landing/site-footer");
    expect(renderToStaticMarkup(createElement(SiteHeader, {}))).toContain('href="/pricing"');
    expect(renderToStaticMarkup(createElement(SiteFooter, {}))).toContain('href="/pricing"');
  });

  it("AC-027-04 the account page data shows projects and AI-checked receipts used this month", async () => {
    const pid = (await projectsRepo.create(world.db, user.id, { name: "app" })).id;
    for (let i = 0; i < 37; i++) await judgeAllowed(world.db, pid);
    const a = await accountView(world.db, user);
    expect(a.billing.beta).toEqual({ projects: 1, projectLimit: 3, judged: 37, judgedLimit: 100 });
  });

  it("AC-027-05 attack: the client cannot raise the limits with a plan, count or project id; a second session or user does not share them", async () => {
    world.signInAs(user);
    for (const name of ["a", "b", "c"]) expect((await createProject(name)).status).toBe(201);
    for (const extra of [{ plan: "pro" }, { limit: 99 }, { projects: 0 }]) {
      expect([400, 402]).toContain((await createProject("d", extra)).status);
    }
    // Parallel creates (a second browser) cannot pass the limit together.
    const results = await Promise.all(["e", "f"].map((n) => createProject(n)));
    expect(results.map((r) => r.status)).toEqual([402, 402]);
    expect(await owned(user.id)).toBe(3);
    // Another user's limits are their own: the first user's usage does not count against them.
    const other = await world.createUser({ name: "other" });
    world.signInAs(other);
    expect((await createProject("mine")).status).toBe(201);
    // Picking an existing project on /device never creates one, so it is not refused by the limit.
    const code = await deviceCode();
    const { items } = await projectsRepo.listByOwner(world.db, user.id, { limit: 1, offset: 0 });
    await expect(
      approveDevice(world.db, other, { user_code: code, project_id: items[0]?.id }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("AC-027-06 without BETA_LIMITS (self-hosted, tests) there is no project or receipt limit", async () => {
    vi.stubEnv("BETA_LIMITS", "");
    expect(betaLimitsOn()).toBe(false);
    world.signInAs(user);
    for (const name of ["1", "2", "3", "4", "5"])
      expect((await createProject(name)).status).toBe(201);
    const pid = (await projectsRepo.create(world.db, user.id, { name: "x" })).id;
    for (let i = 0; i < 150; i++) expect(await judgeAllowed(world.db, pid)).toBe(true);
    expect((await accountView(world.db, user)).billing.beta).toBeNull();
  });
});
