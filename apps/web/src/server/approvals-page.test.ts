import ApprovalsPage from "@/app/projects/[id]/approvals/page";
import { projectsRepo } from "@brain/db";
import { sql } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentAsk } from "./approvals";
import type { SessionUser } from "./auth";
import { resetMigrationCheckForTests } from "./migration-check";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Roadmap Phase 6b: the Approvals tab.
let cookie: string | undefined;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (n: string) => (n === "codeceipt_view" && cookie ? { value: cookie } : undefined),
  }),
}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {} }),
}));

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let pid: string;

beforeEach(async () => {
  resetMigrationCheckForTests();
  cookie = undefined;
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  pid = (await projectsRepo.create(world.db, owner.id, { name: "Shop" })).id;
});
afterEach(async () => {
  resetMigrationCheckForTests();
  await world.teardown();
});

const render = async (view?: string) =>
  renderToStaticMarkup(
    (await ApprovalsPage({
      params: Promise.resolve({ id: pid }),
      searchParams: Promise.resolve(view ? { view } : {}),
    })) as ReactElement,
  );

describe("Phase 6b: the Approvals tab", () => {
  it("PH6B-01 Simple: what is waiting, the presets with the current one, pause buttons and what ran on its own", async () => {
    await agentAsk(world.db, pid, {
      action: "delete_feature",
      summary: "Remove the old cart",
      agent: "claude",
    });
    await agentAsk(world.db, pid, { action: "link_test", summary: "Link the cart test" });
    world.signInAs(owner);
    const html = await render();
    expect(html).toContain("Waiting for you: 1");
    expect(html).toContain("Remove the old cart");
    expect(html).toContain("asked by claude");
    expect(html).toContain("Always approve this kind");
    expect(html).toContain("(current)");
    expect(html).toContain("Pause for 1 hour");
    expect(html).toContain("Link the cart test");
    expect(html).not.toContain("Every action, by preset");
  });

  it("PH6B-02 Detailed: the table of every action by preset and the policy's rules", async () => {
    world.signInAs(owner);
    const html = await render("detailed");
    expect(html).toContain("Every action, by preset");
    expect(html).toContain("Turn off Codeceipt Guard");
    expect(html).toContain("No rules: the preset decides.");
  });

  it("PH6B-03 attack: another signed-in user gets not found; agent text is shown as text", async () => {
    await agentAsk(world.db, pid, {
      action: "delete_feature",
      summary: '<img src=x onerror="alert(1)">',
    });
    world.signInAs(owner);
    const html = await render();
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
    world.signInAs(stranger);
    await expect(render()).rejects.toThrow();
  });

  it("PH6B-04 before migration 0055 the tab says approvals are being set up", async () => {
    await world.db.execute(sql`DELETE FROM "_brain_migrations" WHERE id = '0055_approvals'`);
    resetMigrationCheckForTests();
    world.signInAs(owner);
    expect(await render()).toContain("Approvals are being set up");
  });
});
