// FEAT-021: shareable receipt links. The owner makes a read-only link for one receipt; anyone with the link sees that
// receipt (and nothing else from the project) with a "Receipt by Codeceipt" badge; the owner can revoke it. Only a hash
// of the link's token is stored. Attacker tests are named "attack: ...".
import { POST as createRoute } from "@/app/api/projects/[id]/receipts/[receiptId]/share/route";
import { DELETE as revokeRoute } from "@/app/api/projects/[id]/share-links/[linkId]/route";
import SharedReceiptPage, { generateMetadata } from "@/app/r/[token]/page";
import { projectsRepo, receiptShareLinks, receipts, requestsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth";
import { MAX_ACTIVE_LINKS, sharedReceipt } from "./share-links";
import { type TestWorld, createTestWorld } from "./test-helpers";

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let projectId: string;
let receiptId: string;

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "secret-shop" })).id;
  const created = await requestsRepo.createWithItems(
    world.db,
    projectId,
    { featureId: null, text: "Add reviews to the salon page" },
    [{ text: "Reviews list", needsClarification: false }],
  );
  const [row] = await world.db
    .insert(receipts)
    .values({
      projectId,
      requestId: created.request.id,
      summaryJson: {
        items: [{ id: created.items[0]?.id, text: "Reviews list", status: "done", evidence: [] }],
        findings: [
          {
            type: "stripe_secret_key",
            file: "src/pay.ts",
            line: 2,
            masked_value: "sk_l***",
            hint: "",
          },
        ],
      },
    })
    .returning();
  receiptId = row?.id ?? "";
});

afterEach(async () => {
  await world.teardown();
});

const create = (pid = projectId, rid = receiptId) =>
  createRoute(
    new Request(`http://x/api/projects/${pid}/receipts/${rid}/share`, { method: "POST" }),
    {
      params: Promise.resolve({ id: pid, receiptId: rid }),
    },
  );
const revoke = (linkId: string, pid = projectId) =>
  revokeRoute(
    new Request(`http://x/api/projects/${pid}/share-links/${linkId}`, { method: "DELETE" }),
    {
      params: Promise.resolve({ id: pid, linkId }),
    },
  );
const tokenOf = (url: string) => url.split("/r/")[1] ?? "";
const page = async (token: string) =>
  renderToStaticMarkup(
    (await SharedReceiptPage({ params: Promise.resolve({ token }) })) as ReactElement,
  );

describe("FEAT-021 shareable receipt links", () => {
  it("AC-021-01 the owner makes a link; anyone with it sees the receipt with the badge, without signing in", async () => {
    world.signInAs(owner);
    const res = await create();
    expect(res.status).toBe(200);
    const { link } = (await res.json()) as { link: { id: string; url: string } };
    expect(link.url).toMatch(/\/r\/[A-Za-z0-9_-]{32}$/);
    world.signInAs(null);
    const html = await page(tokenOf(link.url));
    expect(html).toContain("Add reviews to the salon page");
    expect(html).toContain("Reviews list");
    expect(html).toContain("Receipt by Codeceipt");
    expect(html).toContain("sk_l***");
    // Read-only: no owner actions and no fix prompt.
    expect(html).not.toContain("Send fix to agent");
    expect(html).not.toMatch(/Close|Dismiss/);
  });

  it("AC-021-02 a revoked link returns 404 and stays dead; a new link gets a new token", async () => {
    world.signInAs(owner);
    const first = ((await (await create()).json()) as { link: { id: string; url: string } }).link;
    expect((await revoke(first.id)).status).toBe(200);
    await expect(sharedReceipt(world.db, tokenOf(first.url))).resolves.toBeNull();
    const second = ((await (await create()).json()) as { link: { id: string; url: string } }).link;
    expect(tokenOf(second.url)).not.toBe(tokenOf(first.url));
    await expect(sharedReceipt(world.db, tokenOf(first.url))).resolves.toBeNull();
    await expect(sharedReceipt(world.db, tokenOf(second.url))).resolves.not.toBeNull();
  });

  it("AC-021-03 permission: only the owner can make or revoke links; the shared page shows nothing else from the project", async () => {
    world.signInAs(stranger);
    expect((await create()).status).toBe(404);
    world.signInAs(owner);
    const link = ((await (await create()).json()) as { link: { id: string; url: string } }).link;
    world.signInAs(stranger);
    expect((await revoke(link.id)).status).toBe(404);
    world.signInAs(null);
    expect((await create()).status).toBe(401);
    const html = await page(tokenOf(link.url));
    expect(html).not.toContain("secret-shop");
    expect(html).not.toContain(projectId);
  });

  it("AC-021-04 attack: only a hash is stored; guessed or altered tokens are 404; the page is noindex and no-referrer", async () => {
    world.signInAs(owner);
    const link = ((await (await create()).json()) as { link: { id: string; url: string } }).link;
    const token = tokenOf(link.url);
    const [stored] = await world.db.select().from(receiptShareLinks);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    for (const bad of [
      `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`,
      token.slice(0, 31),
      "x".repeat(32),
      "../../etc/passwd",
      "",
    ]) {
      await expect(sharedReceipt(world.db, bad), bad).resolves.toBeNull();
    }
    const meta = await generateMetadata();
    expect(meta.robots).toMatchObject({ index: false, follow: false });
    expect(meta.referrer).toBe("no-referrer");
  });

  it("AC-021-05 boundary: a project can have at most 100 active links", async () => {
    world.signInAs(owner);
    expect(MAX_ACTIVE_LINKS).toBe(100);
    for (let i = 0; i < MAX_ACTIVE_LINKS; i++) expect((await create()).status).toBe(200);
    const res = await create();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { message: string }).message).toMatch(/100 active share links/);
  });
});
