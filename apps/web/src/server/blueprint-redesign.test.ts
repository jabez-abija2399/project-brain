// FEAT-036: the Blueprint for non-engineers. Rules in plain words grouped "It does" / "It must never" (formal wording
// only in Full detail, never in capitals), a summary and a health sentence per feature, Safety check and History with
// their own title, purpose and breadcrumbs, risks said for people with details tucked away, Discover's confirm button.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import DiscoverPage from "@/app/projects/[id]/blueprint/discover/page";
import HistoryPage from "@/app/projects/[id]/blueprint/history/page";
import BlueprintPage from "@/app/projects/[id]/blueprint/page";
import { blueprintRepo, featuresRepo, projectTokensRepo, projectsRepo } from "@brain/db";
import { sql } from "drizzle-orm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { editBlueprint, restoreVersion } from "./blueprint";
import { resetMigrationCheckForTests } from "./migration-check";
import { type TestWorld, createTestWorld } from "./test-helpers";

const SRC = join(__dirname, "..");
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

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

describe("FEAT-036 Blueprint", () => {
  it("AC-036-01 rules read as plain sentences grouped It does / It must never; formal wording only in Full detail, never in capitals", async () => {
    cookie = "simple";
    const simple = await render(BlueprintPage);
    const t = text(simple);
    // FEAT-040 (AC-040-07): the groups are two columns, Always then Never.
    expect(simple).toContain('<h3 class="subhead m0">Never</h3>');
    expect(t).toContain("The app never stores card numbers.");
    expect(simple).toContain('<h3 class="subhead m0">Always</h3>');
    expect(simple).toContain('class="rule-columns"');
    expect(simple).not.toContain("formal wording");
    expect(simple).not.toMatch(/THE SYSTEM SHALL|\bWHEN\b|\bSHALL\b/);
    cookie = "detailed";
    const detailed = await render(BlueprintPage);
    expect(text(detailed)).toContain("formal wording: The system shall not store card numbers.");
    expect(detailed).not.toMatch(/THE SYSTEM SHALL/);
  });

  it("AC-036-02 a summary line and one health sentence per feature with one action; Safety check and History have their own title, purpose and breadcrumbs", async () => {
    cookie = "simple";
    const html = await render(BlueprintPage);
    const t = text(html);
    expect(t).toContain("Your app has 1 part and 2 promises.");
    expect(t).toContain("0 are proven by tests.");
    expect(t).toContain("Checkout: 2 promises, none checked by a test yet.");
    expect(html).toContain(">Copy a prompt for tests</button>");
    await featuresRepo.insert(world.db, pid, { name: "Orders" });
    expect(text(await render(BlueprintPage))).toContain(
      "Orders has no promises yet. Add what it must never do.",
    );
    const discover = await render(DiscoverPage as never);
    expect(discover).toContain(`<a href="/projects/${pid}/blueprint">Blueprint</a>`);
    expect(discover).toContain('<span aria-current="page">Safety check</span>');
    expect(discover).toContain("Problems that could hurt your users, most urgent first");
    const history = await render(HistoryPage as never);
    expect(history).toContain('<span aria-current="page">History</span>');
    expect(history).toContain("Every saved version. Go back to any one; nothing is deleted.");
  });

  it("AC-036-03 safety risks are said for people with paths and SQL under Technical details; Discover confirms a feature with progress", async () => {
    await featuresRepo.insert(world.db, pid, { name: "Orders" });
    await world.db.execute(
      sql`INSERT INTO db_tables (id, project_id, path, schema, name, rls_enabled) VALUES ('t1', ${pid}, 'supabase/migrations/1.sql', 'public', 'orders', false)`,
    );
    const html = await render(DiscoverPage as never);
    expect(text(html)).toContain("Anyone on the internet can read and change this table");
    const details = html.slice(html.indexOf('<details class="tech-details">'));
    expect(details.slice(0, details.indexOf("</details>"))).toContain("supabase/migrations/1.sql");
    const headline = html.slice(
      html.indexOf("Anyone on the internet") - 200,
      html.indexOf("Anyone on the internet"),
    );
    expect(headline).not.toContain("supabase/");
    expect(html).toMatch(
      /<progress class="progress" value="1" max="2" aria-label="1 of 2 features confirmed"/,
    );
    expect(text(html)).toContain("Step 2 of 2: Orders. Does this look right?");
    const source = readFileSync(join(SRC, "app/projects/[id]/blueprint/discover/page.tsx"), "utf8");
    expect(source).toContain('label="Confirm this feature"');
    expect(source).toContain("Your whole app is mapped");
  });

  it("AC-036-04 negative: restoring an old version asks through ConfirmDialog and never deletes newer versions", async () => {
    await editBlueprint(world.db, owner, pid, {
      baseVersion: 1,
      ops: [{ op: "setPurpose", featureId: checkout, purpose: "Take payment" }],
    });
    const actions = readFileSync(
      join(SRC, "app/projects/[id]/blueprint/blueprint-actions.tsx"),
      "utf8",
    );
    expect(actions).toContain("useConfirm");
    expect(actions).not.toContain("window.confirm");
    const html = await render(HistoryPage as never);
    expect(html).toContain(">Restore</button>");
    await restoreVersion(world.db, owner, pid, { version: 1, baseVersion: 2 });
    const versions = await blueprintRepo.listVersions(world.db, pid, 10);
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2, 3]);
  });
});
