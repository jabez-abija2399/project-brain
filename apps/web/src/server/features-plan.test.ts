// FEAT-034: features in plain words. Status agrees with progress, the counts are the chips, each feature has its own
// page (items and receipts), the plan says "Must" / "Must never" and shows as a banner on Features, cards on phones.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import FeaturePage from "@/app/projects/[id]/features/[featureId]/page";
import FeatureBoardPage from "@/app/projects/[id]/features/page";
import {
  checklistItemsRepo,
  featuresRepo,
  planDraftsRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
} from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}));

const SRC = join(__dirname, "..");
let world: TestWorld;
let owner: SessionUser;
let pid: string;
beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  world.signInAs(owner);
  pid = (await projectsRepo.create(world.db, owner.id, { name: "Salon" })).id;
});
afterEach(async () => {
  await world.teardown();
});

const html = async (el: unknown) => renderToStaticMarkup((await el) as ReactElement);
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const board = () =>
  html(
    FeatureBoardPage({ params: Promise.resolve({ id: pid }), searchParams: Promise.resolve({}) }),
  );
const featurePage = (featureId: string, id = pid) =>
  html(FeaturePage({ params: Promise.resolve({ id, featureId }) }));

async function reviews() {
  const f = await featuresRepo.insert(world.db, pid, { name: "Reviews", key: "reviews" });
  const { request, items } = await requestsRepo.createWithItems(
    world.db,
    pid,
    { featureId: f.id, text: "Add reviews" },
    [
      { text: "Show the reviews list", needsClarification: false },
      { text: "Show the average rating", needsClarification: false },
    ],
  );
  await checklistItemsRepo.setStatuses(world.db, pid, [
    { id: items[0]?.id as string, status: "done" },
  ]);
  await receiptsRepo.insert(world.db, pid, {
    requestId: request.id,
    commitSha: null,
    summaryJson: {
      items: [{ id: "x", text: "Show the average rating", status: "missed", evidence: [] }],
    },
  });
  return f;
}

describe("FEAT-034 features and plan", () => {
  it("AC-034-01 status agrees with progress; the counts are the filter chips; a row opens the feature's own page", async () => {
    const f = await reviews();
    await featuresRepo.insert(world.db, pid, { name: "Billing", key: "billing" });
    const page = await board();
    expect(page).toContain('data-feature="reviews" data-status="in_progress" data-open="1"');
    expect(page).not.toContain('class="mini-stats"');
    const chips = page.slice(
      page.indexOf('aria-label="Filter features"'),
      page.indexOf("</fieldset>"),
    );
    expect(text(chips)).toContain("All 2");
    expect(text(chips)).toContain("To do 1");
    expect(text(chips)).toContain("In progress 1");
    expect(page).toContain(`href="/projects/${pid}/features/${f.id}"`);
    expect(text(page)).toContain("Nothing planned yet. Ask your agent: “plan the Billing feature”");
    const detail = text(await featurePage(f.id));
    expect(detail).toContain("Reviews");
    expect(detail).toContain("In progress");
    expect(detail).toContain("1 of 2 done");
    expect(detail).toContain("Show the average rating");
    expect(detail).toContain("Receipts for this feature");
    expect(detail).toContain("Needs a look");
  });

  it("AC-034-02 the plan says Must / Must never, shows as a banner on Features, and says how to ask for changes", async () => {
    const q = await planDraftsRepo.saveQuestions(world.db, pid, {
      ideaText: "Salon bookings",
      questions: { restated: ["A booking app for a salon."], questions: [] },
      createdBy: "token-1",
    });
    await planDraftsRepo.saveDraft(world.db, pid, q.id, {
      answers: {},
      hash: "b".repeat(64),
      draft: {
        restated: ["A booking app for a salon."],
        features: [
          {
            name: "Booking",
            existing: false,
            depends_on: [],
            items: [
              { text: "A customer books a free slot", kind: "happy" },
              { text: "A full slot cannot be booked", kind: "negative" },
            ],
          },
        ],
      },
    });
    const page = await board();
    expect(page).toContain('data-testid="plan-banner"');
    expect(text(page)).toContain("Your agent drafted a plan with 1 feature.");
    expect(page).toMatch(/<span>Must<\/span><\/span> (<!-- -->)?A customer books a free slot/);
    expect(page).toMatch(
      /<span>Must never<\/span><\/span> (<!-- -->)?A full slot cannot be booked/,
    );
    expect(page).not.toMatch(/\[(negative|happy)\]/);
    expect(text(page)).toContain(
      "Not right? Tell your agent what to change, and it drafts the plan again.",
    );
  });

  it("AC-034-03 on phones each feature is a card (rows stack, no 6-column table) and the file count is left out", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.table thead \{\s*display: none;/);
    expect(css).toMatch(/\.table tr \{\s*display: block;/);
    expect(css).toMatch(
      /@media \(max-width: 640px\) \{\s*\.table td\[data-label="Files"\] \{\s*display: none;/,
    );
  });

  it("AC-034-04 permission: a feature page of another user's project, or another project's feature id, is the 404 page", async () => {
    const f = await reviews();
    const stranger = await world.createUser({ name: "stranger" });
    world.signInAs(stranger);
    const err = await featurePage(f.id).catch((e: unknown) => e);
    expect(String((err as { digest?: string }).digest ?? err)).toContain("404");
    // The stranger's own project with the owner's feature id is not found either.
    const theirs = (await projectsRepo.create(world.db, stranger.id, { name: "Theirs" })).id;
    const cross = await featurePage(f.id, theirs).catch((e: unknown) => e);
    expect(String((cross as { digest?: string }).digest ?? cross)).toContain("404");
    const junk = await featurePage("not an id", theirs).catch((e: unknown) => e);
    expect(String((junk as { digest?: string }).digest ?? junk)).toContain("404");
  });
});
