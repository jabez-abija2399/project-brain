import ConnectPage from "@/app/projects/[id]/connect/page";
import StartPage from "@/app/start/page";
import { deviceCodesRepo, filesRepo, projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// The Connect tab shows the same `npx codeceipt` flow as the start page, with the status of this project only.
let world: TestWorld;
let owner: SessionUser;

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  world.signInAs(owner);
});
afterEach(async () => {
  await world.teardown();
});

const render = async (el: Promise<unknown>) => renderToStaticMarkup((await el) as ReactElement);
const connect = (id: string) => render(ConnectPage({ params: Promise.resolve({ id }) }));
const steps = (html: string) =>
  [...html.matchAll(/data-step="(\d)" data-status="(\w+)"/g)].map((m) => `${m[1]}:${m[2]}`);
const titles = (html: string) =>
  [
    ...html.matchAll(
      /data-step="\d"[^>]*>.*?<h2[^>]*>(?:<!-- -->)?\d(?:<!-- -->)?\. (?:<!-- -->)?([^<]+)<\/h2>/gs,
    ),
  ].map((m) => m[1]);
const copies = (html: string) => [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);

async function link(projectId: string, code: string) {
  const now = new Date();
  await deviceCodesRepo.create(
    world.db,
    {
      deviceCodeHash: `h-${code}`,
      userCode: code,
      suggestedName: null,
      expiresAt: new Date(now.getTime() + 600_000),
    },
    now,
  );
  await deviceCodesRepo.decide(world.db, code, { userId: owner.id, projectId }, now);
  await deviceCodesRepo.poll(world.db, `h-${code}`, new Date(now.getTime() + 10_000), 0);
}

describe("Connect tab", () => {
  it("shows the start page's three steps and only the npx codeceipt command (no login, init or index commands)", async () => {
    const project = await projectsRepo.create(world.db, owner.id, { name: "shop" });
    const html = await connect(project.id);
    expect(titles(html)).toEqual([
      "Run npx codeceipt in your project",
      "Approve in the browser",
      "Open Claude Code or Cursor and make a change",
    ]);
    expect(titles(html)).toEqual(titles(await render(StartPage())));
    expect(steps(html)).toEqual(["1:waiting", "2:waiting", "3:waiting"]);
    expect(copies(html)).toEqual(["npx codeceipt"]);
    expect(html).not.toMatch(/codeceipt login|codeceipt init|codeceipt index|api-url/);
    expect(html).toContain('data-live="on"');
  });

  it("each step follows this project: linked, first index, first receipt (with a link to its receipts)", async () => {
    const project = await projectsRepo.create(world.db, owner.id, { name: "shop" });
    await link(project.id, "BCDF-GHJK");
    expect(steps(await connect(project.id))).toEqual(["1:done", "2:waiting", "3:waiting"]);
    await filesRepo.insert(world.db, project.id, { path: "src/App.tsx", hash: "a".repeat(64) });
    expect(steps(await connect(project.id))).toEqual(["1:done", "2:done", "3:waiting"]);
    const request = await requestsRepo.insert(world.db, project.id, { text: "Add reviews" });
    await receiptsRepo.insert(world.db, project.id, {
      requestId: request.id,
      commitSha: null,
      summaryJson: {
        items: [],
        files_by_feature: [],
        outside_scope: [],
        not_verified: [],
        llm_calls: 0,
      },
    });
    const html = await connect(project.id);
    expect(steps(html)).toEqual(["1:done", "2:done", "3:done"]);
    expect(html).toContain('data-live="off"');
    expect(html).toContain(`href="/projects/${project.id}/receipts"`);
  });

  it("attack: another project of the same user, linked and indexed, never marks this project's steps done", async () => {
    const mine = await projectsRepo.create(world.db, owner.id, { name: "shop" });
    const other = await projectsRepo.create(world.db, owner.id, { name: "blog" });
    await link(other.id, "CDFG-HJKL");
    await filesRepo.insert(world.db, other.id, { path: "src/App.tsx", hash: "b".repeat(64) });
    expect(steps(await connect(mine.id))).toEqual(["1:waiting", "2:waiting", "3:waiting"]);
    expect(steps(await connect(other.id))).toEqual(["1:done", "2:done", "3:waiting"]);
  });

  it("attack: a stranger gets the 404 page for someone else's Connect tab", async () => {
    const project = await projectsRepo.create(world.db, owner.id, { name: "shop" });
    world.signInAs(await world.createUser({ name: "stranger" }));
    const err = await ConnectPage({ params: Promise.resolve({ id: project.id }) }).catch((e) => e);
    expect(String(err?.digest ?? err?.message)).toContain("404");
  });
});
