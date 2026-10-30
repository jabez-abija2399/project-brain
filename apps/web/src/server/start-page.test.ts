import { GET as onboardingRoute } from "@/app/api/onboarding/route";
import FeaturesPage from "@/app/projects/[id]/features/page";
import PlanPage from "@/app/projects/[id]/plan/page";
import ProposalsPage from "@/app/projects/[id]/proposals/page";
import ReceiptsPage from "@/app/projects/[id]/receipts/page";
import ProjectsPage from "@/app/projects/page";
import StartPage from "@/app/start/page";
import { deviceCodesRepo, filesRepo, projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// Journey part 1-2: the guided start page after sign-in, its live status, and empty states that teach.
let world: TestWorld;
let owner: SessionUser;

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  world.signInAs(owner);
});
afterEach(async () => {
  await world.teardown();
});

const render = async (el: Promise<unknown> | unknown) =>
  renderToStaticMarkup((await el) as ReactElement);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const steps = (html: string) =>
  [...html.matchAll(/data-step="(\d)" data-status="(\w+)"/g)].map((m) => `${m[1]}:${m[2]}`);
const redirectOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { digest?: string }) => String(e?.digest ?? e),
  );

// What `npx codeceipt` leaves behind: an approved, collected device code for a new project, then the first index.
async function linked(name = "shop") {
  const project = await projectsRepo.create(world.db, owner.id, { name });
  const now = new Date();
  const created = await deviceCodesRepo.create(
    world.db,
    {
      deviceCodeHash: `h-${name}`,
      userCode: "BCDF-GHJK",
      suggestedName: name,
      expiresAt: new Date(now.getTime() + 600_000),
    },
    now,
  );
  if (!created) throw new Error("no device code");
  await deviceCodesRepo.decide(
    world.db,
    "BCDF-GHJK",
    { userId: owner.id, projectId: project.id },
    now,
  );
  await deviceCodesRepo.poll(world.db, `h-${name}`, new Date(now.getTime() + 10_000), 0);
  return project;
}

describe("guided start page", () => {
  it("a brand-new user is sent from /projects to /start, which shows the 3 steps, all waiting, and the copy button", async () => {
    expect(await redirectOf(ProjectsPage({ searchParams: Promise.resolve({}) }))).toContain(
      "/start",
    );
    const html = await render(StartPage());
    const t = text(html);
    expect(t).toContain("Run npx codeceipt in your project");
    expect(t).toContain("Approve in the browser");
    expect(t).toContain("Open Claude Code or Cursor and make a change");
    expect(steps(html)).toEqual(["1:waiting", "2:waiting", "3:waiting"]);
    expect([...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1])).toEqual(["npx codeceipt"]);
    // The page keeps checking on its own while a step is waiting.
    expect(html).toContain('data-live="on"');
  });

  it("each step turns done on its own: project linked, first index, first receipt (then the receipt is shown and explained)", async () => {
    const project = await linked();
    expect(steps(await render(StartPage()))).toEqual(["1:done", "2:waiting", "3:waiting"]);

    await filesRepo.insert(world.db, project.id, { path: "src/App.tsx", hash: "a".repeat(64) });
    expect(steps(await render(StartPage()))).toEqual(["1:done", "2:done", "3:waiting"]);

    const request = await requestsRepo.insert(world.db, project.id, { text: "Add a star rating" });
    await receiptsRepo.insert(world.db, project.id, {
      requestId: request.id,
      commitSha: null,
      summaryJson: {
        items: [
          { id: "i1", text: "Add the StarRating component", status: "done", evidence: [] },
          {
            id: "i2",
            text: "Show the average on the product page",
            status: "missed",
            evidence: [],
          },
        ],
        files_by_feature: [],
        outside_scope: [],
        not_verified: [],
        llm_calls: 1,
      },
    });
    const html = await render(StartPage());
    expect(steps(html)).toEqual(["1:done", "2:done", "3:done"]);
    expect(html).toContain('data-live="off"');
    const t = text(html);
    expect(t).toContain("Your first receipt");
    expect(t).toContain("Show the average on the product page");
    for (const section of [
      "Asked",
      "Checklist",
      "Changed outside",
      "Security findings",
      "Test checks",
      "Not verified",
    ]) {
      expect(t).toContain(section);
    }
    expect(html).toContain(`href="/projects/${project.id}/receipts"`);
    // Once a receipt exists, /projects is the normal list again.
    expect(await redirectOf(ProjectsPage({ searchParams: Promise.resolve({}) }))).toBeNull();
  });

  it("/projects?all=1 skips the guide", async () => {
    expect(
      await redirectOf(ProjectsPage({ searchParams: Promise.resolve({ all: "1" }) })),
    ).toBeNull();
  });

  it("GET /api/onboarding reports the live status of the user's own project only", async () => {
    const project = await linked();
    const res = await onboardingRoute(new Request("https://codeceipts.test/api/onboarding"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({
      projectId: project.id,
      steps: { linked: true, indexed: false, receipt: false },
    });
  });

  it("attack: signed out gets 401, and another user never sees the owner's project or progress", async () => {
    await linked();
    world.signInAs(null);
    expect(
      (await onboardingRoute(new Request("https://codeceipts.test/api/onboarding"))).status,
    ).toBe(401);
    const stranger = await world.createUser({ name: "stranger" });
    world.signInAs(stranger);
    const res = await onboardingRoute(new Request("https://codeceipts.test/api/onboarding"));
    expect(await res.json()).toEqual({
      projectId: null,
      steps: { linked: false, indexed: false, receipt: false },
    });
    expect(steps(await render(StartPage()))).toEqual(["1:waiting", "2:waiting", "3:waiting"]);
  });
});

describe("empty states that teach", () => {
  it("Features, Receipts, Proposals and Plan each say in one sentence what will appear and how to make it appear", async () => {
    const project = await projectsRepo.create(world.db, owner.id, { name: "shop" });
    const params = Promise.resolve({ id: project.id });
    const searchParams = Promise.resolve({});
    const pages = {
      Features: await render(FeaturesPage({ params, searchParams })),
      Receipts: await render(ReceiptsPage({ params, searchParams })),
      Proposals: await render(ProposalsPage({ params, searchParams })),
      Plan: await render(PlanPage({ params })),
    };
    const expected: Record<string, RegExp> = {
      Features: /features .*appear here .*run npx codeceipt/i,
      Receipts: /receipt .*appears here .*make a change with Claude Code or Cursor/i,
      Proposals: /appear here .*when an agent asks to reword or drop/i,
      Plan: /plan .*appears here .*ask your agent to plan/i,
    };
    for (const [tab, html] of Object.entries(pages)) {
      const sentence = /data-testid="empty-state".*?<p[^>]*>([^<]+)<\/p>/s.exec(html)?.[1] ?? "";
      const plain = text(sentence).trim();
      expect([tab, plain]).toEqual([tab, expect.stringMatching(expected[tab] as RegExp)]);
      // One sentence: a single full stop, at the end.
      expect([tab, plain.split(/[.!?](\s|$)/).filter((s) => s.trim()).length]).toEqual([tab, 1]);
    }
  });
});
