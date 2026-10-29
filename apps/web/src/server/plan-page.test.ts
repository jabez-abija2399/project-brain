import PlanPage from "@/app/projects/[id]/plan/page";
import { planDraftsRepo, projectsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {} }),
}));

let world: TestWorld;
let owner: SessionUser;
let projectId: string;

const render = async () =>
  renderToStaticMarkup(
    (await PlanPage({ params: Promise.resolve({ id: projectId }) })) as ReactElement,
  );

async function storeDraft(names: { name: string; existing: boolean }[]) {
  const q = await planDraftsRepo.saveQuestions(world.db, projectId, {
    ideaText: "Yoga bookings",
    questions: { restated: ["A booking app for a yoga studio."], questions: [] },
    createdBy: "token-1",
  });
  return planDraftsRepo.saveDraft(world.db, projectId, q.id, {
    answers: {},
    hash: "a".repeat(64),
    draft: {
      restated: ["A booking app for a yoga studio."],
      features: names.map((n) => ({
        ...n,
        depends_on: [],
        items: n.existing ? [] : [{ text: "Booking a full class is refused", kind: "negative" }],
      })),
    },
  });
}

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "Studio" })).id;
  world.signInAs(owner);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await world.teardown();
});

describe("FEAT-019 Plan tab", () => {
  it("AC-019-04 empty state: no plan yet points to connecting an agent", async () => {
    const html = await render();
    expect(html).toContain(`aria-current="page" href="/projects/${projectId}/plan">Plan</a>`);
    expect(html).toContain("No plan yet");
    expect(html).toContain(`/projects/${projectId}/connect`);
  });

  it("AC-019-04 the draft is shown with its status in words, and the approve button names that draft", async () => {
    const row = await storeDraft([
      { name: "Accounts", existing: true },
      { name: "Bookings", existing: false },
    ]);
    const html = await render();
    expect(html).toContain("Waiting for your approval");
    expect(html).toContain("1. Accounts");
    expect(html).toContain("Already built");
    expect(html).toContain("New");
    expect(html).toContain("[negative] </span>Booking a full class is refused");
    expect(html).toContain("Approve this plan");
    // Status is never color alone: each badge has an icon and a label.
    expect(html).toMatch(
      /data-status="done"><span aria-hidden="true">.<\/span><span>Already built/,
    );
    expect(row?.status).toBe("draft");
  });

  it("AC-019-05 after approval the tab says so and names the next feature", async () => {
    const row = await storeDraft([{ name: "Bookings", existing: false }]);
    await planDraftsRepo.approve(
      world.db,
      projectId,
      row?.id ?? "",
      "a".repeat(64),
      owner.id,
      new Date(),
    );
    const html = await render();
    expect(html).toContain("Plan approved");
    expect(html).toContain("Next feature: Bookings.");
  });

  it("AC-019-04 permission: another user's project is the 404 page", async () => {
    world.signInAs(await world.createUser({ name: "stranger" }));
    const err = await render().catch((e: unknown) => e);
    expect(String((err as { digest?: string }).digest ?? err)).toContain("404");
  });
});
