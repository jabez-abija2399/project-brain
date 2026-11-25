// FEAT-032: the overview leads with one decision and one button; the headline count is the list under it; the four
// numbers use plain words and each opens the receipts already filtered; "All clear" when nothing needs a look.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import OverviewPage from "@/app/projects/[id]/overview/page";
import ReceiptsPage from "@/app/projects/[id]/receipts/page";
import { projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
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
  pid = (await projectsRepo.create(world.db, owner.id, { name: "edutech" })).id;
});
afterEach(async () => {
  await world.teardown();
});

const overview = async (id = pid) =>
  renderToStaticMarkup((await OverviewPage({ params: Promise.resolve({ id }) })) as ReactElement);
const receipts = async (filter?: string, id = pid) =>
  renderToStaticMarkup(
    (await ReceiptsPage({
      params: Promise.resolve({ id }),
      searchParams: Promise.resolve(filter ? { filter } : {}),
    })) as ReactElement,
  );
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

async function receipt(projectId: string, asked: string, summary: Record<string, unknown>) {
  const request = await requestsRepo.insert(world.db, projectId, { text: asked });
  return receiptsRepo.insert(world.db, projectId, {
    requestId: request.id,
    commitSha: null,
    summaryJson: { files_by_feature: [], outside_scope: [], not_verified: [], ...summary },
  });
}
const missed = { items: [{ id: "m", text: "Empty state", status: "missed", evidence: [] }] };
const good = { items: [{ id: "g", text: "Footer", status: "done", evidence: [] }] };
const secret = {
  items: [{ id: "s", text: "Pay", status: "done", evidence: [] }],
  findings: [{ type: "stripe_secret_key", file: "src/pay.ts", line: 3, hint: "Move it" }],
};

describe("FEAT-032 overview", () => {
  it("AC-032-01 the headline and next step are one block with one primary button; the headline count equals the list under it", async () => {
    await receipt(pid, "Add reviews", missed);
    await receipt(pid, "Add payments", secret);
    await receipt(pid, "Add a footer", good);
    const html = await overview();
    const hero = html.slice(
      html.indexOf('class="overview-hero'),
      html.indexOf('class="stat-grid"'),
    );
    expect(text(hero)).toContain("2 receipts need your attention this week");
    expect(text(hero)).toContain("Next step");
    expect(hero.match(/btn btn-primary/g)).toHaveLength(1);
    expect(hero).toContain(`href="/projects/${pid}/receipts?filter=attention">Review them</a>`);
    expect(html.match(/btn btn-primary/g)).toHaveLength(1);
    const list = html.slice(html.indexOf('aria-labelledby="needs"'));
    expect(list.slice(0, list.indexOf("</section>")).match(/class="attention-item"/g)).toHaveLength(
      2,
    );
  });

  it("AC-032-02 the stat cards use plain words and each opens the receipts already filtered to its items", async () => {
    await receipt(pid, "Add reviews", missed);
    await receipt(pid, "Add payments", secret);
    await receipt(pid, "Add a footer", good);
    const t = text(await overview());
    for (const label of ["Things your agent missed", "Built as asked", "Security problems"]) {
      expect(t).toContain(label);
    }
    expect(t).toContain("Passwords or keys in your code, or data anyone can read");
    const html = await overview();
    for (const f of ["attention", "missed", "good", "findings"]) {
      expect(html).toContain(`href="/projects/${pid}/receipts?filter=${f}"`);
    }
    const filtered = await receipts("missed");
    expect(filtered).toContain('data-filter="missed"');
    expect(filtered).toMatch(/aria-pressed="true"[^>]*>Something missed/);
    expect(filtered.match(/data-missed="true"/g)).toHaveLength(1);
    expect(await receipts("findings")).toContain('data-filter="findings"');
    // An unknown filter is ignored, never echoed.
    const odd = await receipts("<script>");
    expect(odd).toContain('data-filter="all"');
    expect(odd).not.toContain("<script>");
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    expect(css).toContain('.receipts-filtered[data-filter="missed"] li[data-missed="false"]');
    expect(css).toContain('.receipts-filtered[data-filter="findings"] li[data-findings="false"]');
  });

  it("AC-032-03 with nothing to look at the page says All clear; on phones the four numbers are a 2x2 grid", async () => {
    await receipt(pid, "Add a footer", good);
    const t = text(await overview());
    expect(t).toContain("All clear. Everything your agents did this week checks out");
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    expect(css).toMatch(
      /@media \(max-width: 560px\) \{\s*\.stat-grid \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
  });

  it("AC-032-04 permission: counts and filtered lists only ever include the owner's own project", async () => {
    await receipt(pid, "Add a footer", good);
    const stranger = await world.createUser({ name: "stranger" });
    const theirs = (await projectsRepo.create(world.db, stranger.id, { name: "theirs" })).id;
    await receipt(theirs, "Their secret change", secret);
    await receipt(theirs, "Their missed change", missed);
    const mine = text(await overview());
    expect(mine).toContain("All clear");
    expect(mine).not.toContain("Their secret change");
    expect(await receipts("findings")).not.toContain("Their secret change");
    // The stranger's id in the address of the owner's session is the 404 page.
    for (const render of [() => overview(theirs), () => receipts("missed", theirs)]) {
      const err = await render().catch((e: unknown) => e);
      expect(String((err as { digest?: string }).digest ?? err)).toContain("404");
    }
  });
});
