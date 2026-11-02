// 2026-11-02: open checklist items. The start note listed one request about the main page's top comment about eight times
// (H1: merged at creation), old open items stayed open after later receipts showed them done (H2: one-time cleanup),
// the owner could not close or dismiss an item (H3), and the dashboard header must have no empty list items (D).
// Attacker tests are named "attack: ..."; every other test is a case the user's real session needed.
import { ChecklistItem } from "@/components/checklist-item";
import { AppShell } from "@/components/shell/app-shell";
import { GET as openItemsHook } from "@/app/api/hooks/[projectId]/open-items/route";
import { POST as cleanupRoute } from "@/app/api/projects/[id]/open-items/cleanup/route";
import { PATCH as itemRoute } from "@/app/api/projects/[id]/checklist-items/[itemId]/route";
import { POST as closeRoute } from "@/app/api/projects/[id]/checklist-items/[itemId]/close/route";
import { itemKey } from "@brain/core";
import type { CompleteRequest, Llm } from "@brain/core";
import {
  checklistItemsRepo,
  featuresRepo,
  projectTokensRepo,
  projectsRepo,
  requests,
  requestsRepo,
} from "@brain/db";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { createChecklist } from "./checklist";
import { setLlmForTests } from "./llm";
import { captureRequest } from "./request-capture";
import { type TestWorld, createTestWorld } from "./test-helpers";

// The item's buttons refresh the page through the router; the static render has no router, so the test supplies one.
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}));

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let projectId: string;
let pricingId: string;
let reviewsId: string;
let token: string;
let tokenRow: { id: string; projectId: string };
let otherProjectId: string;
let otherFeatureId: string;
let answer: string;

const MAIN = "Add a short comment at the top of the main page";

function scripted(text: string) {
  const llm: Llm = {
    async complete(_req: CompleteRequest) {
      return text;
    },
  };
  setLlmForTests(llm);
}

// A request with one item, made at `when` (set explicitly so "later" is exact), optionally with its item's status set.
async function seed(
  pid: string,
  featureId: string | null,
  text: string,
  when: Date,
  status?: "done" | "done_untested",
): Promise<string> {
  const created = await requestsRepo.createWithItems(
    world.db,
    pid,
    { featureId, text: `request: ${text}` },
    [{ text, needsClarification: false }],
  );
  await world.db.update(requests).set({ createdAt: when }).where(eq(requests.id, created.request.id));
  const id = created.items[0]?.id as string;
  if (status) await checklistItemsRepo.setStatuses(world.db, pid, [{ id, status }]);
  return id;
}

async function statusOf(id: string, pid = projectId): Promise<string | undefined> {
  return (await checklistItemsRepo.byId(world.db, pid, id))?.status;
}

async function openKeyCount(key: string, pid = projectId): Promise<number> {
  const open = await checklistItemsRepo.listOpenForProject(world.db, pid, 500);
  return open.filter((i) => itemKey(i.text) === key).length;
}

const itemCtx = (id: string, itemId: string) => ({ params: Promise.resolve({ id, itemId }) });
const projectCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const patch = (pid: string, itemId: string, body: unknown) =>
  itemRoute(
    new Request(`http://x/api/projects/${pid}/checklist-items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    itemCtx(pid, itemId),
  );

const close = (pid: string, itemId: string) =>
  closeRoute(
    new Request(`http://x/api/projects/${pid}/checklist-items/${itemId}/close`, { method: "POST" }),
    itemCtx(pid, itemId),
  );

const cleanup = (pid: string) =>
  cleanupRoute(
    new Request(`http://x/api/projects/${pid}/open-items/cleanup`, { method: "POST" }),
    projectCtx(pid),
  );

const startNote = (pid: string, pidToken: string) =>
  openItemsHook(
    new Request(`http://x/api/hooks/${pid}/open-items`, {
      headers: { authorization: `Bearer ${pidToken}` },
    }),
    { params: Promise.resolve({ projectId: pid }) },
  );

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  pricingId = (await featuresRepo.insert(world.db, projectId, { name: "Pricing" })).id;
  reviewsId = (await featuresRepo.insert(world.db, projectId, { name: "Reviews" })).id;
  const created = await projectTokensRepo.create(world.db, projectId);
  token = created.token;
  tokenRow = created.row;
  otherProjectId = (await projectsRepo.create(world.db, stranger.id, { name: "other" })).id;
  otherFeatureId = (await featuresRepo.insert(world.db, otherProjectId, { name: "Secret" })).id;
  answer = "- placeholder";
  scripted(answer);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  setLlmForTests(undefined);
  vi.restoreAllMocks();
  await world.teardown();
});

describe("H1 near-duplicate open items are merged at creation", () => {
  it("the exact example: a new item that repeats an open item of the same feature reuses it", async () => {
    const existing = await seed(projectId, pricingId, "Add a comment at the top of the main page", new Date("2026-10-01"));
    scripted("- Add a short comment at the top of the main page\n- Add a pricing page");
    const out = await createChecklist(world.db, tokenRow, {
      projectId,
      feature: pricingId,
      request: "Add a short comment at the top of the main page and a pricing page",
    });
    expect(out.items.map((i) => i.id)).toContain(existing);
    expect(out.items.map((i) => i.text)).toContain("Add a pricing page");
    expect(await openKeyCount(itemKey(MAIN))).toBe(1);
  });

  it("a feature's open item is not reused for a different feature", async () => {
    const footer = (await featuresRepo.insert(world.db, projectId, { name: "Footer" })).id;
    const elsewhere = await seed(projectId, footer, MAIN, new Date("2026-10-01"));
    scripted("- Add a short comment at the top of the main page");
    const out = await createChecklist(world.db, tokenRow, {
      projectId,
      feature: pricingId,
      request: "Add a comment on the main page",
    });
    expect(out.items.map((i) => i.id)).not.toContain(elsewhere);
    expect(out.items.length).toBe(1);
  });

  it("a done item is never reused: the new item is stored as open", async () => {
    const done = await seed(projectId, pricingId, MAIN, new Date("2026-10-01"), "done");
    scripted("- Add a short comment at the top of the main page");
    const out = await createChecklist(world.db, tokenRow, {
      projectId,
      feature: pricingId,
      request: "Add a comment on the main page again",
    });
    expect(out.items.map((i) => i.id)).not.toContain(done);
    expect(await statusOf(out.items[0]?.id as string)).toBe("open");
  });

  it("attack: another project's open item with the same text is never reused", async () => {
    const theirs = await seed(otherProjectId, otherFeatureId, MAIN, new Date("2026-10-01"));
    scripted("- Add a short comment at the top of the main page");
    const out = await createChecklist(world.db, tokenRow, {
      projectId,
      feature: pricingId,
      request: "Add a comment on the main page",
    });
    expect(out.items.map((i) => i.id)).not.toContain(theirs);
    expect(await statusOf(theirs, otherProjectId)).toBe("open");
    expect(await openKeyCount(itemKey(MAIN), otherProjectId)).toBe(1);
  });

  it("a prompt-submit capture that repeats an open item of the same feature adds no second item", async () => {
    await seed(projectId, reviewsId, "Add a comment at the top of the main page", new Date("2026-10-01"));
    scripted("FEATURE: Reviews\n- Add a short comment at the top of the main page");
    const result = await captureRequest(world.db, projectId, {
      text: "Please add a comment to the main page",
      session_id: "sess-h1",
    });
    expect(result).toMatchObject({ recorded: true, items: 0 });
    expect(await openKeyCount(itemKey(MAIN))).toBe(1);
  });
});

describe("H2 one-time cleanup of existing open items", () => {
  // Seeds the 2026-11-02 shape: three near-duplicate open items of the comment, and an open pricing item that a
  // later request's receipt shows done.
  async function seedMess() {
    const t = (d: string) => new Date(`2026-10-0${d}T10:00:00Z`);
    const pricingOpen = await seed(projectId, pricingId, "Add a pricing page", t("1"));
    await seed(projectId, pricingId, MAIN, t("1"));
    await seed(projectId, pricingId, "Add a comment to the main page", t("2"));
    await seed(projectId, pricingId, "Please add a comment at the top of the main page", t("3"));
    await seed(projectId, pricingId, "Add a pricing page", t("4"), "done");
    return { pricingOpen };
  }

  it("after cleanup one open item remains and the item a later receipt showed done is closed", async () => {
    const { pricingOpen } = await seedMess();
    world.signInAs(owner);
    const res = await cleanup(projectId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, closed: 1, merged: 2 });
    const open = await checklistItemsRepo.listOpenForProject(world.db, projectId, 500);
    expect(open.map((i) => i.text)).toEqual(["Please add a comment at the top of the main page"]);
    expect(await statusOf(pricingOpen)).toBe("done");
  });

  it("running cleanup twice changes nothing the second time", async () => {
    await seedMess();
    world.signInAs(owner);
    await cleanup(projectId);
    const snapshot = (await checklistItemsRepo.listOpenForProject(world.db, projectId, 500)).map(
      (i) => `${i.id}:${i.status}`,
    );
    const res = await cleanup(projectId);
    expect(await res.json()).toEqual({ ok: true, closed: 0, merged: 0 });
    expect(
      (await checklistItemsRepo.listOpenForProject(world.db, projectId, 500)).map(
        (i) => `${i.id}:${i.status}`,
      ),
    ).toEqual(snapshot);
  });

  it("attack: a stranger gets 404 and no item changes; anonymous gets 401", async () => {
    await seedMess();
    const before = (await checklistItemsRepo.listOpenForProject(world.db, projectId, 500)).length;
    world.signInAs(stranger);
    expect((await cleanup(projectId)).status).toBe(404);
    world.signInAs(null);
    expect((await cleanup(projectId)).status).toBe(401);
    expect((await checklistItemsRepo.listOpenForProject(world.db, projectId, 500)).length).toBe(
      before,
    );
  });
});

describe("H3 the owner can dismiss or close an open item", () => {
  it("attack: a stranger cannot dismiss an item of someone else's project (404), and it stays open", async () => {
    const id = await seed(projectId, pricingId, MAIN, new Date("2026-10-01"));
    world.signInAs(stranger);
    const res = await patch(projectId, id, { dismiss: true });
    expect(res.status).toBe(404);
    expect(await statusOf(id)).toBe("open");
  });

  it("attack: a request without a signed-in owner (an agent token) cannot dismiss", async () => {
    const id = await seed(projectId, pricingId, MAIN, new Date("2026-10-01"));
    world.signInAs(null);
    expect((await patch(projectId, id, { dismiss: true })).status).toBe(401);
    expect(await statusOf(id)).toBe("open");
  });

  it("attack: a dismiss body with extra fields is refused and changes nothing", async () => {
    const id = await seed(projectId, pricingId, MAIN, new Date("2026-10-01"));
    world.signInAs(owner);
    expect((await patch(projectId, id, { dismiss: true, text: "x" })).status).toBe(400);
    expect(await statusOf(id)).toBe("open");
  });

  it("the owner dismisses an item: it is kept as dismissed and the start note no longer lists it", async () => {
    const id = await seed(projectId, pricingId, MAIN, new Date("2026-10-01"));
    const other = await seed(projectId, pricingId, "Add a pricing page", new Date("2026-10-01"));
    world.signInAs(owner);
    const res = await patch(projectId, id, { dismiss: true });
    expect(res.status).toBe(200);
    expect((await res.json()).item.status).toBe("dismissed");
    expect(await statusOf(id)).toBe("dismissed");
    const note = await startNote(projectId, token);
    expect(note.status).toBe(200);
    const body = await note.json();
    const texts = body.requests.flatMap((r: { items: { text: string }[] }) =>
      r.items.map((i) => i.text),
    );
    expect(texts).not.toContain(MAIN);
    expect(texts).toContain("Add a pricing page");
    expect(await statusOf(other)).toBe("open");
  });

  it("dismissing twice is harmless", async () => {
    const id = await seed(projectId, pricingId, MAIN, new Date("2026-10-01"));
    world.signInAs(owner);
    expect((await patch(projectId, id, { dismiss: true })).status).toBe(200);
    expect((await patch(projectId, id, { dismiss: true })).status).toBe(200);
    expect(await statusOf(id)).toBe("dismissed");
  });

  it("the owner closes an open item as done; a stranger gets 404 and it stays open", async () => {
    const id = await seed(projectId, pricingId, MAIN, new Date("2026-10-01"));
    world.signInAs(stranger);
    expect((await close(projectId, id)).status).toBe(404);
    expect(await statusOf(id)).toBe("open");
    world.signInAs(owner);
    const res = await close(projectId, id);
    expect(res.status).toBe(200);
    expect(await statusOf(id)).toBe("done");
  });
});

describe("H3 the item component offers Close and Dismiss", () => {
  it("an open item shows a Dismiss button whose accessible name includes the item text", () => {
    const html = renderToStaticMarkup(
      ChecklistItem({
        text: MAIN,
        status: "partial",
        evidence: [],
        action: { projectId: "p1", itemId: "i1" },
      }),
    );
    expect(html).toMatch(new RegExp(`<button[^>]*aria-label="Dismiss: ${MAIN}"`));
    expect(html).toMatch(new RegExp(`<button[^>]*aria-label="Close: ${MAIN}"`));
  });

  it("without an item id (a receipt row) the component renders no action buttons", () => {
    const html = renderToStaticMarkup(
      ChecklistItem({ text: MAIN, status: "partial", evidence: [] }),
    );
    expect(html).not.toContain("<button");
  });
});

describe("D the dashboard header has no empty list items", () => {
  function headerOf(projects: { id: string; name: string }[]) {
    const html = renderToStaticMarkup(
      AppShell({ user: { name: "Ada", email: "ada@example.com" }, projects, children: null }),
    );
    return html.slice(html.indexOf("<header"), html.indexOf("</header>") + "</header>".length);
  }
  const itemTexts = (header: string) =>
    [...header.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
      (m[1] ?? "").replace(/<[^>]*>/g, "").trim(),
    );

  it("a project with an empty name is labelled, not an empty list item", () => {
    const texts = itemTexts(headerOf([{ id: "p1", name: "" }, { id: "p2", name: "app" }]));
    expect(texts).toEqual(["Untitled project", "app"]);
    expect(texts.every((t) => t !== "")).toBe(true);
  });

  it("a project with a whitespace-only name is labelled, not an empty list item", () => {
    const texts = itemTexts(headerOf([{ id: "p1", name: "   \t " }]));
    expect(texts).toEqual(["Untitled project"]);
  });

  it("with zero projects the header has no list at all", () => {
    const header = headerOf([]);
    expect(header).not.toContain("<li");
    expect(header).not.toContain("<ul");
  });
});
