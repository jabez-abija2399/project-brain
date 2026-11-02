// 2026-11-02 (owner items 1, 2 and 3 on the overview): the open items with the owner's Close and Dismiss, the "Clean up
// open items" control, and items the owner closed. Attacker tests are named "attack: ...".
import OverviewPage from "@/app/projects/[id]/overview/page";
import { checklistItemsRepo, projectsRepo, requestsRepo } from "@brain/db";
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

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let projectId: string;

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  world.signInAs(owner);
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
});
afterEach(async () => {
  await world.teardown();
});

const render = (id = projectId) =>
  OverviewPage({ params: Promise.resolve({ id }) }).then((el) =>
    renderToStaticMarkup(el as ReactElement),
  );

async function openItem(text: string) {
  const created = await requestsRepo.createWithItems(
    world.db,
    projectId,
    { featureId: null, text: `request: ${text}` },
    [{ text, needsClarification: false }],
  );
  return created.items[0]?.id as string;
}

describe("overview: open items and the clean up control (owner items 1 and 2)", () => {
  it("lists each open item with Close and Dismiss named by its text, and offers Clean up open items", async () => {
    await openItem("Show the reviews list");
    const html = await render();
    expect(html).toContain('aria-label="Dismiss: Show the reviews list"');
    expect(html).toContain('aria-label="Close: Show the reviews list"');
    expect(html).toContain("Clean up open items");
  });

  it("an item the owner closed is no longer listed as open", async () => {
    const id = await openItem("Show the reviews list");
    await checklistItemsRepo.closeItems(world.db, projectId, [{ id, status: "done" }], {
      byOwner: true,
    });
    const html = await render();
    expect(html).not.toContain('aria-label="Dismiss: Show the reviews list"');
  });

  it("attack: a stranger cannot open the overview of someone else's project", async () => {
    await openItem("Show the reviews list");
    world.signInAs(stranger);
    await expect(render()).rejects.toBeDefined();
  });
});
