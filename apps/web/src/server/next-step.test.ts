import { GET as nextStepRoute } from "@/app/api/hooks/[projectId]/next-step/route";
import OverviewPage from "@/app/projects/[id]/overview/page";
import { planDraftsRepo, projectTokensRepo, projectsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentAsk } from "./approvals";
import type { SessionUser } from "./auth";
import { resetMigrationCheckForTests } from "./migration-check";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Roadmap Phase 9: one next step on the Overview page and for `codeceipt status`.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {} }),
}));

let world: TestWorld;
let owner: SessionUser;
let stranger: SessionUser;
let pid: string;
let token: string;
let otherToken: string;

beforeEach(async () => {
  resetMigrationCheckForTests();
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  pid = (await projectsRepo.create(world.db, owner.id, { name: "Shop" })).id;
  const other = (await projectsRepo.create(world.db, stranger.id, { name: "Vault" })).id;
  token = (await projectTokensRepo.create(world.db, pid)).token;
  otherToken = (await projectTokensRepo.create(world.db, other)).token;
});
afterEach(async () => {
  resetMigrationCheckForTests();
  await world.teardown();
});

const state = async (t = token) =>
  nextStepRoute(
    new Request(`http://localhost/api/hooks/${pid}/next-step`, {
      headers: { authorization: `Bearer ${t}` },
    }),
    { params: Promise.resolve({ projectId: pid }) },
  );
const render = async () =>
  renderToStaticMarkup(
    (await OverviewPage({ params: Promise.resolve({ id: pid }) })) as ReactElement,
  );

describe("Phase 9: next step", () => {
  it("PH9-05 the status route sends counts only: a pending approval and a plan draft are counted", async () => {
    await agentAsk(world.db, pid, { action: "delete_feature", summary: "drop old" });
    const q = await planDraftsRepo.saveQuestions(world.db, pid, {
      ideaText: "x",
      questions: { restated: ["x"], questions: [] },
      createdBy: "t",
    });
    await planDraftsRepo.saveDraft(world.db, pid, q.id, {
      answers: {},
      hash: "a".repeat(64),
      draft: { restated: ["x"], features: [] },
    });
    const res = await state();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: Record<string, unknown> };
    expect(body.state).toEqual({
      pendingApprovals: 1,
      planDraft: true,
      receipts: 0,
      openMissed: 0,
      features: 0,
      criteria: 0,
    });
  });

  it("PH9-06 attack: another project's token gets 404 and learns nothing", async () => {
    await agentAsk(world.db, pid, { action: "delete_feature", summary: "drop old" });
    expect((await state(otherToken)).status).toBe(404);
  });

  it("PH9-07 the Overview shows the same next step, with its page, command and agent ask", async () => {
    world.signInAs(owner);
    const empty = await render();
    expect(empty).toContain("Next step");
    expect(empty).toContain("Connect a repository and finish one agent session");
    expect(empty).toContain(`href="/projects/${pid}/connect"`);
    expect(empty).toContain("<code>npx codeceipt</code>");
    await agentAsk(world.db, pid, { action: "delete_feature", summary: "drop old" });
    expect(await render()).toContain(
      "Your agents are waiting for you: 1 request to approve or reject.",
    );
  });
});

describe("Phase 9: docs/actions.md", () => {
  it("PH9-11 every MCP tool and every project tab is in docs/actions.md", async () => {
    const { readFileSync } = await import("node:fs");
    const doc = readFileSync(new URL("../../../../docs/actions.md", import.meta.url), "utf8");
    const tools = readFileSync(new URL("./mcp-tools.ts", import.meta.url), "utf8");
    const names = [...tools.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1] as string);
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(doc, n).toContain(`\`${n}\``);
    const nav = readFileSync(
      new URL("../app/projects/[id]/project-nav.tsx", import.meta.url),
      "utf8",
    );
    const tabsBlock = nav.slice(nav.indexOf("const TABS"), nav.indexOf("] as const"));
    const tabs = [...tabsBlock.matchAll(/label: "([A-Za-z]+)"/g)].map((m) => m[1] as string);
    expect(tabs.length).toBeGreaterThan(5);
    for (const t of tabs) expect(doc, t).toContain(`${t} tab`);
  });
});
