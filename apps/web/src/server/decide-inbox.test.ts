// FEAT-035: To decide, one inbox. Requests read as sentences with Approve / Reject and "Remember my choice", proposals
// show the change and the agent's reason, a rejection's "why not" reaches the agent, expired requests say so, and
// only the owner's session can decide anything.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POST as decideRoute } from "@/app/api/projects/[id]/approvals/decide/route";
import { PATCH as itemRoute } from "@/app/api/projects/[id]/checklist-items/[itemId]/route";
import DecidePage from "@/app/projects/[id]/decide/page";
import {
  approvalRequests,
  decisionsRepo,
  projectTokensRepo,
  projectsRepo,
  requestsRepo,
} from "@brain/db";
import { eq } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentAsk } from "./approvals";
import type { SessionUser } from "./auth";
import { proposeChecklistChange } from "./checklist";
import { resetMigrationCheckForTests } from "./migration-check";
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
let world: TestWorld;
let owner: SessionUser;
let pid: string;
let token: { token: string; row: { id: string; projectId: string } };
beforeEach(async () => {
  resetMigrationCheckForTests();
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  world.signInAs(owner);
  pid = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  token = await projectTokensRepo.create(world.db, pid);
});
afterEach(async () => {
  resetMigrationCheckForTests();
  await world.teardown();
});

const page = async () =>
  renderToStaticMarkup(
    (await DecidePage({
      params: Promise.resolve({ id: pid }),
      searchParams: Promise.resolve({}),
    })) as ReactElement,
  );
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
const decide = (body: object, headers: Record<string, string> = {}) =>
  decideRoute(
    new Request(`http://localhost/api/projects/${pid}/approvals/decide`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: pid }) },
  );
const patchItem = (itemId: string, body: object, headers: Record<string, string> = {}) =>
  itemRoute(
    new Request(`http://localhost/api/projects/${pid}/checklist-items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: pid, itemId }) },
  );

async function proposal() {
  const { items } = await requestsRepo.createWithItems(
    world.db,
    pid,
    { featureId: null, text: "Add reviews" },
    [{ text: "Show the reviews", needsClarification: false }],
  );
  const itemId = items[0]?.id as string;
  await proposeChecklistChange(world.db, token.row as never, {
    itemId,
    text: "Show the 10 newest reviews",
    reason: "The list is too long on phones",
  });
  return itemId;
}

describe("FEAT-035 To decide", () => {
  it("AC-035-01 requests and proposals share one list: a sentence, Approve / Reject, Remember my choice, and when it expires", async () => {
    await agentAsk(world.db, pid, { action: "delete_feature", summary: "Remove the old cart" });
    await proposal();
    const html = await page();
    const t = text(html);
    expect(t).toContain("Your agent wants to: Delete a feature");
    expect(t).toMatch(/expires in (23|24) hours/);
    expect(html).toContain('aria-label="Approve: Remove the old cart"');
    expect(html).toContain('aria-label="Reject: Remove the old cart"');
    expect(t).toContain("Remember my choice for this kind of action");
    expect(t).not.toContain("Always approve this kind");
    expect(t).not.toContain("delete_feature");
    // The proposal is in the same list.
    expect(html).toContain("<ins>Show the 10 newest reviews</ins>");
  });

  it("AC-035-02 a proposal shows the old text struck through, the new text and the agent's reason; a rejection's reason reaches the agent", async () => {
    const itemId = await proposal();
    const html = await page();
    expect(html).toContain("<del>Show the reviews</del>");
    expect(html).toContain("<ins>Show the 10 newest reviews</ins>");
    expect(html).toContain("Agent&#x27;s reason: <q>The list is too long on phones</q>");
    const actions = readFileSync(
      join(SRC, "app/projects/[id]/proposals/proposal-actions.tsx"),
      "utf8",
    );
    expect(actions).toContain("<span>Why not? (optional)</span>");
    // Rejecting the exact proposal shown, with a why-not, records it for the agent.
    const { checklistItemsRepo } = await import("@brain/db");
    const row = await checklistItemsRepo.byId(world.db, pid, itemId);
    const res = await patchItem(itemId, {
      reject: true,
      proposal: { proposedAt: row?.proposedAt?.toISOString(), change: row?.proposedChange },
      reason: "Keep showing all of them",
    });
    expect(res.status).toBe(200);
    const [latest] = await decisionsRepo.listNewest(world.db, pid, 1);
    expect(latest?.title).toBe('The owner rejected a proposed change to "Show the reviews"');
    expect(latest?.reason).toBe("Keep showing all of them");
  });

  it("AC-035-03 attack: a project token or another user can neither approve nor reject a request or a proposal", async () => {
    const asked = (await agentAsk(world.db, pid, {
      action: "delete_feature",
      summary: "Drop cart",
    })) as {
      id: string;
    };
    const itemId = await proposal();
    const { checklistItemsRepo } = await import("@brain/db");
    const row = await checklistItemsRepo.byId(world.db, pid, itemId);
    const shown = { proposedAt: row?.proposedAt?.toISOString(), change: row?.proposedChange };
    const bearer = { authorization: `Bearer ${token.token}` };
    // Only the token: no signed-in browser session.
    world.signInAs(null);
    // The agent's own token: 401 on every owner action.
    for (const decision of ["approve", "reject"]) {
      expect((await decide({ requestId: asked.id, decision }, bearer)).status).toBe(401);
    }
    expect((await patchItem(itemId, { confirm: true, proposal: shown }, bearer)).status).toBe(401);
    expect((await patchItem(itemId, { reject: true, proposal: shown }, bearer)).status).toBe(401);
    // Another signed-in user: 404.
    world.signInAs(await world.createUser({ name: "stranger" }));
    for (const decision of ["approve", "reject"]) {
      expect((await decide({ requestId: asked.id, decision })).status).toBe(404);
    }
    expect((await patchItem(itemId, { confirm: true, proposal: shown })).status).toBe(404);
    expect((await patchItem(itemId, { reject: true, proposal: shown })).status).toBe(404);
    // Nothing changed: the request still waits, the proposal is still there, no decision was recorded.
    world.signInAs(owner);
    expect(text(await page())).toContain("Drop cart");
    expect((await checklistItemsRepo.byId(world.db, pid, itemId))?.proposedChange).not.toBeNull();
    expect(await decisionsRepo.listNewest(world.db, pid, 5)).toEqual([]);
  });

  it("AC-035-04 an expired request cannot be approved and says 'This request expired'", async () => {
    const asked = (await agentAsk(world.db, pid, {
      action: "delete_feature",
      summary: "Old ask",
    })) as {
      id: string;
    };
    await world.db
      .update(approvalRequests)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(approvalRequests.id, asked.id));
    // An expired request is no longer offered (no Approve button); if the owner still sends a decision, it says why.
    const html = await page();
    expect(html).not.toContain('aria-label="Approve: Old ask"');
    expect(
      readFileSync(join(SRC, "app/projects/[id]/approvals/approval-sections.tsx"), "utf8"),
    ).toContain("This request expired. Your agent can ask again if it still needs it.");
    const res = await decide({ requestId: asked.id, decision: "approve" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toContain("This request expired");
  });
});
