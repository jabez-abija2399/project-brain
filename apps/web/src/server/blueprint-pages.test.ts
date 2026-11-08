import DiscoverPage from "@/app/projects/[id]/blueprint/discover/page";
import HistoryPage from "@/app/projects/[id]/blueprint/history/page";
// Roadmap Phase 3c: the Blueprint tab, Discover and History pages (Simple and Detailed views, the first-visit
// question, owner-only actions, escaping of stored text).
import BlueprintPage from "@/app/projects/[id]/blueprint/page";
import { featuresRepo, projectTokensRepo, projectsRepo } from "@brain/db";
import { sql } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { editBlueprint } from "./blueprint";
import { proposeBlueprint } from "./blueprint-agent";
import { viewMode } from "./blueprint-page";
import { resetMigrationCheckForTests } from "./migration-check";
import { type TestWorld, createTestWorld } from "./test-helpers";

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
let checkout: string;
let tok: { id: string; projectId: string };

const props = (id = pid, view?: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve(view ? { view } : {}),
});
const render = async (page: (p: ReturnType<typeof props>) => Promise<unknown>, p = props()) =>
  renderToStaticMarkup((await page(p)) as ReactElement);

beforeEach(async () => {
  resetMigrationCheckForTests();
  cookie = undefined;
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  pid = (await projectsRepo.create(world.db, owner.id, { name: "Shop" })).id;
  checkout = (await featuresRepo.insert(world.db, pid, { name: "Checkout" })).id;
  const created = await projectTokensRepo.create(world.db, pid);
  tok = { id: created.row.id, projectId: pid };
  await editBlueprint(world.db, owner, pid, {
    baseVersion: 0,
    ops: [
      {
        op: "addCriterion",
        featureId: checkout,
        text: "THE SYSTEM SHALL NOT store card numbers",
        kind: "must_never",
      },
      {
        op: "addCriterion",
        featureId: checkout,
        text: "The checkout should be fast",
        kind: "behaviour",
      },
    ],
  });
  world.signInAs(owner);
});
afterEach(async () => {
  resetMigrationCheckForTests();
  await world.teardown();
});

describe("Phase 3c: Blueprint tab", () => {
  it("BP-3C-01 the first visit asks how the owner works; the answer picks Simple or Detailed and is remembered", async () => {
    const first = await render(BlueprintPage);
    expect(first).toContain("Do you usually read the code your AI writes?");
    cookie = "simple";
    const simple = await render(BlueprintPage);
    expect(simple).not.toContain("Do you usually read the code your AI writes?");
    expect(simple).toContain("Checkout");
    expect(simple).toContain("2 rules: 0 proven");
    expect(simple).not.toContain("Not proven yet");
    cookie = "detailed";
    const detailed = await render(BlueprintPage);
    expect(detailed).toContain("THE SYSTEM SHALL NOT store card numbers.");
    expect(detailed).toContain("Not proven yet");
    expect(detailed).toContain("Must never");
    expect(detailed).toMatch(/makes this optional/);
    expect(await render(BlueprintPage, props(pid, "simple"))).not.toContain("Not proven yet");
    expect(viewMode("bogus", undefined)).toBeNull();
  });

  it("BP-3C-02 agent proposals wait for the owner with Accept and Dismiss, and their text is shown escaped", async () => {
    await proposeBlueprint(world.db, tok, {
      feature: "Checkout",
      text: '<img src=x onerror="alert(1)"> THE SYSTEM SHALL email a receipt',
      kind: "behaviour",
    });
    cookie = "simple";
    const html = await render(BlueprintPage);
    expect(html).toContain("Waiting for you: 1 suggested by your agent");
    expect(html).toContain("Accept");
    expect(html).toContain("Dismiss");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("BP-3C-03 before the Blueprint is set up, the tab says so and nothing breaks", async () => {
    await world.db.execute(sql`DELETE FROM "_brain_migrations" WHERE id = '0054_blueprint'`);
    resetMigrationCheckForTests();
    for (const page of [BlueprintPage, DiscoverPage, HistoryPage]) {
      const html = await render(page as never);
      expect(html).toMatch(/being set up|No versions yet/);
    }
  });

  it("BP-3C-04 attack: another user gets a 404 on every Blueprint page", async () => {
    world.signInAs(stranger);
    for (const page of [BlueprintPage, DiscoverPage, HistoryPage]) {
      const err = await (page as (p: unknown) => Promise<unknown>)(props()).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeTruthy();
    }
  });
});

describe("Phase 3c: Discover and History pages", () => {
  it("BP-3C-05 Discover shows the safety check with a copyable fix prompt and the next feature to confirm", async () => {
    await featuresRepo.insert(world.db, pid, { name: "Orders" });
    await world.db.execute(
      sql`INSERT INTO db_tables (id, project_id, path, schema, name, rls_enabled) VALUES ('t1', ${pid}, 'supabase/migrations/1.sql', 'public', 'orders', false)`,
    );
    const html = await render(DiscoverPage as never);
    expect(html).toContain("Safety check");
    expect(html).toContain("a table anyone can read and change");
    expect(html).toContain("Fix with my agent");
    expect(html).toMatch(/data-copy="[^"]*public\.orders/);
    expect(html).toContain("Next: Orders");
    expect(html).toContain("Add this rule");
    expect(html).toContain("1 of 2 features confirmed");
  });

  it("BP-3C-06 History lists every version, newest first, with Restore on older ones", async () => {
    await editBlueprint(world.db, owner, pid, {
      baseVersion: 1,
      ops: [{ op: "setPurpose", featureId: checkout, purpose: "Take payment" }],
    });
    const html = await render(HistoryPage as never);
    expect(html.indexOf("Version 2")).toBeLessThan(html.indexOf("Version 1"));
    expect(html).toContain("Current");
    expect(html.match(/>Restore</g)).toHaveLength(1);
  });

  it("BP-3C-11 one primary action per view, and repeated buttons say what they act on", async () => {
    const empty = (await projectsRepo.create(world.db, owner.id, { name: "Empty" })).id;
    const first = await render(BlueprintPage, props(empty));
    expect(first.match(/btn-primary/g)).toHaveLength(1);
    await proposeBlueprint(world.db, tok, {
      feature: "Checkout",
      text: "THE SYSTEM SHALL email a receipt",
      kind: "behaviour",
    });
    cookie = "simple";
    const html = await render(BlueprintPage);
    expect(html).toContain('aria-label="Accept: THE SYSTEM SHALL email a receipt"');
    expect(html).toContain('aria-label="Dismiss: THE SYSTEM SHALL email a receipt"');
  });
});
