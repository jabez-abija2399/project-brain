import { PATCH as decide } from "@/app/api/projects/[id]/checklist-items/[itemId]/route";
import ConnectPage from "@/app/projects/[id]/connect/page";
import ProjectError from "@/app/projects/[id]/error";
import FeatureBoardPage from "@/app/projects/[id]/features/page";
import Loading from "@/app/projects/[id]/loading";
import ProposalsPage from "@/app/projects/[id]/proposals/page";
import ReceiptsPage from "@/app/projects/[id]/receipts/page";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  checklistItemsRepo,
  featureFilesRepo,
  featuresRepo,
  filesRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
} from "@brain/db";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { receiptsFeed } from "./dashboard";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {} }),
}));

let world: TestWorld;
let owner: SessionUser;
let other: SessionUser;
let projectId: string;

const props = (page?: string) => ({
  params: Promise.resolve({ id: projectId }),
  searchParams: Promise.resolve(page ? { page } : {}),
});
const html = async (page: Promise<ReactElement>) => renderToStaticMarkup(await page);

async function seedReceipts(n: number) {
  const feature = await featuresRepo.insert(world.db, projectId, {
    name: "Reviews",
    key: "reviews",
  });
  const { request, items } = await requestsRepo.createWithItems(
    world.db,
    projectId,
    { featureId: feature.id, text: "Add reviews" },
    [
      { text: "Show the reviews list", needsClarification: false },
      { text: "Email the owner", needsClarification: false },
    ],
  );
  for (let i = 0; i < n; i++) {
    await receiptsRepo.insert(world.db, projectId, {
      requestId: request.id,
      commitSha: null,
      summaryJson: {
        items: [
          {
            id: items[0]?.id,
            text: "Show the reviews list",
            status: "done",
            evidence: ["src/reviews/List.tsx"],
          },
          { id: items[1]?.id, text: `Email the owner (${i})`, status: "missed", evidence: [] },
        ],
        outside_scope: ["src/billing/Invoice.tsx"],
        not_verified: [],
        findings: [
          {
            type: "rls_disabled",
            file: "supabase/migrations/0001.sql",
            line: null,
            hint: "RLS is off.",
          },
        ],
        findings_omitted: 0,
      },
    });
  }
  return { feature, request, items };
}

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  other = await world.createUser({ name: "other" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "Shop" })).id;
  world.signInAs(owner);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await world.teardown();
});

describe("FEAT-017 dashboard", () => {
  it("AC-017-01 the feature board lists features with status, file count, open items and last receipt date", async () => {
    const { feature } = await seedReceipts(1);
    const file = await filesRepo.insert(world.db, projectId, {
      path: "src/reviews/List.tsx",
      hash: "a".repeat(64),
    });
    await featureFilesRepo.link(world.db, projectId, { featureId: feature.id, fileId: file.id });
    await featuresRepo.insert(world.db, projectId, { name: "Billing", key: "billing" });
    const page = await html(FeatureBoardPage(props()));
    expect(page).toContain("2 features");
    const reviewsRow = page.slice(page.indexOf("<strong>Reviews</strong>"));
    expect(reviewsRow).toMatch(/data-label="Files"[^>]*>1</);
    expect(reviewsRow).toContain("2 open");
    expect(reviewsRow).toContain(new Date().toISOString().slice(0, 10));
    expect(page).toContain("None yet");
  });

  it("AC-017-02 the receipts feed shows ReceiptCards newest first with asked, done, missed, outside scope and checks", async () => {
    await seedReceipts(3);
    const page = await html(ReceiptsPage(props()));
    expect(page.match(/data-testid="receipt-card"/g)).toHaveLength(3);
    expect(page.indexOf("Email the owner (2)")).toBeLessThan(page.indexOf("Email the owner (0)"));
    for (const part of [
      "Asked: Add reviews",
      "1 done",
      "1 missed",
      "1 outside scope",
      "1 findings",
      "src/billing/Invoice.tsx",
      "RLS is off.",
    ]) {
      expect(page).toContain(part);
    }
  });

  it("AC-017-06 'Send fix to agent' copies a prompt listing the receipt's missed items", async () => {
    await seedReceipts(1);
    const page = await html(ReceiptsPage(props()));
    const copy = page.match(/data-copy="([^"]*)"/)?.[1] ?? "";
    expect(page).toContain("Send fix to agent");
    expect(copy).toContain("2. [missed] Email the owner (0)".slice(3));
    expect(copy).not.toContain("Show the reviews list");
  });

  it("AC-017-03 every list has loading, empty (one action), error and success states", async () => {
    for (const [page, title] of [
      [FeatureBoardPage, "No features yet"],
      [ReceiptsPage, "No receipts yet"],
      [ProposalsPage, "No proposals waiting"],
    ] as const) {
      const empty = await html(page(props()));
      expect(empty).toContain(title);
      const block = empty.slice(empty.indexOf('data-testid="empty-state"'));
      expect(block.match(/class="btn[^"]*"/g)).toHaveLength(1);
    }
    expect(renderToStaticMarkup(createElement(Loading))).toContain("Loading");
    const error = renderToStaticMarkup(createElement(ProjectError, { reset: () => {} }));
    expect(error).toContain('role="alert"');
    expect(error).toContain("Try again");
    await seedReceipts(1);
    expect(await html(ReceiptsPage(props()))).toContain('data-testid="receipt-card"');
  });

  it("AC-017-04 permission: another user's project shows the 404 page on every dashboard page", async () => {
    await seedReceipts(1);
    world.signInAs(other);
    for (const page of [FeatureBoardPage, ReceiptsPage, ProposalsPage]) {
      const err = await page(props()).catch((e) => e);
      expect(String(err?.digest ?? err?.message)).toContain("404");
    }
    const err = await ConnectPage({ params: Promise.resolve({ id: projectId }) }).catch((e) => e);
    expect(String(err?.digest ?? err?.message)).toContain("404");
  });

  it("AC-017-05 the receipts feed loads 50 receipts in under 800 ms p95 and paginates beyond 50", async () => {
    await seedReceipts(60);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      const feed = await receiptsFeed(world.db, owner, projectId, 1);
      times.push(performance.now() - started);
      expect(feed.rows).toHaveLength(50);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    console.info(`[perf] receipts feed, 50 receipts: p95 ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(800);
    const second = await receiptsFeed(world.db, owner, projectId, 2);
    expect(second.rows).toHaveLength(10);
    expect(second.pages).toBe(2);
    expect(await html(ReceiptsPage(props("2")))).toContain("Page 2 of 2");
  });

  it("AC-017-02 status is never color alone: every badge has an icon and a label", () => {
    for (const status of [
      "done",
      "partial",
      "missed",
      "open",
      "warning",
      "not_verified",
    ] as const) {
      const badge = renderToStaticMarkup(createElement(StatusBadge, { status }));
      expect(badge).toMatch(/<span aria-hidden="true">.+<\/span><span>[A-Z][^<]+<\/span>/);
    }
  });
});

describe("FEAT-017 checklist proposals", () => {
  const patch = (itemId: string, body: unknown) =>
    decide(
      new Request(`http://x/api/projects/${projectId}/checklist-items/${itemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: projectId, itemId }) },
    );

  it("AC-017-03 the proposals screen confirms or rejects exactly the proposal it showed", async () => {
    const { items } = await seedReceipts(0);
    const [a, b] = items as [{ id: string }, { id: string }];
    await checklistItemsRepo.propose(
      world.db,
      projectId,
      a.id,
      { text: "Show the 10 newest reviews" },
      new Date("2026-10-29T10:00:00.123Z"),
    );
    await checklistItemsRepo.propose(
      world.db,
      projectId,
      b.id,
      { dismiss: true },
      new Date("2026-10-29T10:00:01Z"),
    );
    const page = await html(ProposalsPage(props()));
    expect(page).toContain("Proposed: </span>Show the 10 newest reviews");
    expect(page).toContain("Drop item");
    const shownA = {
      proposedAt: "2026-10-29T10:00:00.123Z",
      change: { text: "Show the 10 newest reviews" },
    };
    expect((await patch(a.id, { confirm: true, proposal: shownA })).status).toBe(200);
    expect((await checklistItemsRepo.byId(world.db, projectId, a.id))?.text).toBe(
      "Show the 10 newest reviews",
    );
    const shownB = { proposedAt: "2026-10-29T10:00:01.000Z", change: { dismiss: true } };
    expect((await patch(b.id, { reject: true, proposal: shownB })).status).toBe(200);
    const after = await checklistItemsRepo.byId(world.db, projectId, b.id);
    expect([after?.status, after?.proposedChange]).toEqual(["open", null]);
  });

  it("AC-017-04 attack: an agent swapping the proposal between viewing and confirming gets nothing applied (409)", async () => {
    const { items } = await seedReceipts(0);
    const item = items[0] as { id: string };
    await checklistItemsRepo.propose(
      world.db,
      projectId,
      item.id,
      { text: "Harmless wording" },
      new Date("2026-10-29T10:00:00Z"),
    );
    const shown = { proposedAt: "2026-10-29T10:00:00.000Z", change: { text: "Harmless wording" } };
    // The agent replaces the proposal after the owner opened the page.
    await checklistItemsRepo.propose(
      world.db,
      projectId,
      item.id,
      { dismiss: true },
      new Date("2026-10-29T10:00:05Z"),
    );
    for (const body of [
      { confirm: true, proposal: shown },
      { reject: true, proposal: shown },
    ]) {
      const res = await patch(item.id, body);
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("proposal_changed");
    }
    const row = await checklistItemsRepo.byId(world.db, projectId, item.id);
    expect([row?.status, row?.text, row?.proposedChange]).toEqual([
      "open",
      "Show the reviews list",
      { dismiss: true },
    ]);
    world.signInAs(other);
    expect((await patch(item.id, { reject: true, proposal: shown })).status).toBe(404);
  });
});
