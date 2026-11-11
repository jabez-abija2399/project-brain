import { POST as webhook } from "@/app/api/github/webhook/route";
import { PUT as settingsRoute } from "@/app/api/projects/[id]/settings/route";
import { prCommentMarker } from "@brain/core";
import { githubRepo, projectTokensRepo, projectsRepo, receiptsRepo } from "@brain/db";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import type { GithubConfig } from "./github";
import { makeGithubConfig, restoreGithub, sign } from "./github-test-helpers";
import { PR_EVENT, type PrEventData, setPrEventSenderForTests } from "./inngest";
import { resetMigrationCheckForTests } from "./migration-check";
import { runPrReceipt } from "./pr-receipt";
import { projectSettingsView, setPrReceipts } from "./project-settings";
import type { GithubClient, StepRunner } from "./push-index";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Roadmap Phase 10b: receipts on pull requests. Off by default; the owner turns it on; never for forks; a public
// repository's comment has counts only.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const HEAD = "c".repeat(40);
const OTHER = "d".repeat(40);
const ORIGIN = "https://codeceipt.example";
const step: StepRunner = { run: (_name, fn) => fn() };

let world: TestWorld;
let config: GithubConfig;
let owner: SessionUser;
let stranger: SessionUser;
let pid: string;
let sent: { name: string; data: PrEventData }[];
let delivery = 0;

beforeEach(async () => {
  resetMigrationCheckForTests();
  world = await createTestWorld();
  config = makeGithubConfig();
  owner = await world.createUser({ name: "owner" });
  stranger = await world.createUser({ name: "stranger" });
  pid = (await projectsRepo.create(world.db, owner.id, { name: "app" })).id;
  await githubRepo.linkProject(world.db, pid, owner.id, 77, "acme/app");
  sent = [];
  setPrEventSenderForTests(async (events) => {
    sent.push(...events);
  });
});
afterEach(async () => {
  setPrEventSenderForTests(undefined);
  restoreGithub();
  resetMigrationCheckForTests();
  await world.teardown();
});

const prBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    action: "opened",
    number: 5,
    pull_request: { head: { sha: HEAD, repo: { full_name: "acme/app" } } },
    repository: { full_name: "acme/app", private: true },
    installation: { id: 77 },
    ...over,
  });
function deliver(body: string, signature?: string | null) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": "pull_request",
    "x-github-delivery": `pr-delivery-${++delivery}`,
  };
  const sig = signature === undefined ? sign(body, config.webhookSecret) : signature;
  if (sig !== null) headers["x-hub-signature-256"] = sig;
  return webhook(
    new Request("http://localhost/api/github/webhook", { method: "POST", headers, body }),
  );
}

type Call = { route: string; params: Record<string, unknown> };
function fakeGithub(opts: { comments?: unknown[]; deny?: RegExp; visibility?: string } = {}) {
  const calls: Call[] = [];
  const client: GithubClient = {
    request: async (route, params = {}) => {
      calls.push({ route, params });
      if (opts.deny?.test(route)) throw Object.assign(new Error("denied"), { status: 403 });
      if (route.includes("/pulls/")) return { data: [{ sha: HEAD }, { sha: OTHER }] };
      if (route === "GET /repos/{owner}/{repo}")
        return { data: { visibility: opts.visibility ?? "private" } };
      if (route.startsWith("GET") && route.includes("/comments"))
        return { data: opts.comments ?? [] };
      return { data: {} };
    },
  };
  return { calls, github: async () => client };
}
const event = (over: Partial<PrEventData> = {}): PrEventData => ({
  projectId: pid,
  installationId: 77,
  repo: "acme/app",
  number: 5,
  headSha: HEAD,
  publicRepo: false,
  deliveryId: "d1",
  ...over,
});
const receipt = (projectId: string, commitSha: string, text: string) =>
  receiptsRepo.insert(world.db, projectId, {
    requestId: null,
    commitSha,
    summaryJson: { items: [{ id: "i1", text, status: "missed" }] },
  });

describe("Phase 10b: PR receipts", () => {
  it("PH10B-08 off by default: a pull request enqueues nothing until the owner turns it on", async () => {
    expect((await deliver(prBody())).status).toBe(200);
    expect(sent).toEqual([]);
    await setPrReceipts(world.db, owner, pid, { prReceipts: true });
    // A new delivery (the same signed body sent again counts as a duplicate).
    const res = await deliver(prBody({ action: "synchronize" }));
    expect(res.status).toBe(202);
    expect(sent).toEqual([
      {
        name: PR_EVENT,
        data: expect.objectContaining({
          projectId: pid,
          number: 5,
          headSha: HEAD,
          publicRepo: false,
        }),
      },
    ]);
  });

  it("PH10B-09 attack: an unsigned webhook, a fork's pull request and other actions enqueue nothing; unknown visibility counts as public", async () => {
    await setPrReceipts(world.db, owner, pid, { prReceipts: true });
    expect((await deliver(prBody(), null)).status).toBe(401);
    expect((await deliver(prBody(), `sha256=${"0".repeat(64)}`)).status).toBe(401);
    const fork = prBody({
      pull_request: { head: { sha: HEAD, repo: { full_name: "mallory/app" } } },
    });
    expect((await deliver(fork)).status).toBe(200);
    const deletedFork = prBody({ pull_request: { head: { sha: HEAD, repo: null } } });
    expect((await deliver(deletedFork)).status).toBe(200);
    expect((await deliver(prBody({ action: "closed" }))).status).toBe(200);
    expect(sent).toEqual([]);
    await deliver(prBody({ repository: { full_name: "acme/app" } }));
    expect(sent[0]?.data.publicRepo).toBe(true);
  });

  it("PH10B-10 attack: only the owner changes the setting; a stranger gets 404, a project token 401, bad input 400", async () => {
    await expect(
      setPrReceipts(world.db, stranger, pid, { prReceipts: true }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(setPrReceipts(world.db, owner, pid, { prReceipts: "yes" })).rejects.toMatchObject({
      status: 400,
    });
    const token = (await projectTokensRepo.create(world.db, pid)).token;
    const res = await settingsRoute(
      new Request(`http://localhost/api/projects/${pid}/settings`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ prReceipts: true }),
      }),
      { params: Promise.resolve({ id: pid }) },
    );
    expect(res.status).toBe(401);
    expect(await projectSettingsView(world.db, owner, pid)).toMatchObject({
      ready: true,
      prReceipts: false,
      repoConnected: true,
    });
  });

  it("PH10B-11 the job posts one comment for this project's receipts of the pull request's commits, and a check run", async () => {
    await setPrReceipts(world.db, owner, pid, { prReceipts: true });
    await receipt(pid, HEAD, "Show prices in euros");
    const other = (await projectsRepo.create(world.db, stranger.id, { name: "vault" })).id;
    await receipt(other, HEAD, "Another project's secret item");
    const gh = fakeGithub();
    const result = await runPrReceipt(world.db, event(), step, gh.github, ORIGIN);
    expect(result).toEqual({ receipts: 1, comment: "created", check: true });
    const post = gh.calls.find((c) => c.route.startsWith("POST") && c.route.includes("/comments"));
    const body = String(post?.params.body);
    expect(body.startsWith(prCommentMarker(pid))).toBe(true);
    expect(body).toContain("- `Show prices in euros`");
    expect(body).not.toContain("Another project");
    expect(body).toContain(`${ORIGIN}/projects/${pid}/receipts`);
    const check = gh.calls.find((c) => c.route.includes("/check-runs"));
    expect(check?.params).toMatchObject({ head_sha: HEAD, conclusion: "neutral" });
  });

  it("PH10B-12 attack (security review): only this App's own comment for this project is updated in place", async () => {
    await setPrReceipts(world.db, owner, pid, { prReceipts: true });
    await receipt(pid, HEAD, "Show prices in euros");
    const mine = prCommentMarker(pid);
    const gh = fakeGithub({
      comments: [
        { id: 1, body: `${mine}\nby a person`, user: { type: "User" } },
        // Another project's comment on the same repository, and another App's bot using our marker.
        {
          id: 2,
          body: `${prCommentMarker("other-project")}\nold`,
          user: { type: "Bot" },
          performed_via_github_app: { id: 42 },
        },
        {
          id: 3,
          body: `${mine}\nsquatter`,
          user: { type: "Bot" },
          performed_via_github_app: { id: 7 },
        },
        {
          id: 4,
          body: `${mine}\nold`,
          user: { type: "Bot" },
          performed_via_github_app: { id: 42 },
        },
      ],
    });
    const result = await runPrReceipt(world.db, event(), step, gh.github, ORIGIN, 42);
    expect(result).toMatchObject({ comment: "updated" });
    const patch = gh.calls.find((c) => c.route.startsWith("PATCH"));
    expect(patch?.params.comment_id).toBe(4);
    expect(gh.calls.some((c) => c.route.startsWith("POST") && c.route.includes("/comments"))).toBe(
      false,
    );
  });

  it("PH10B-13 attack: a public repository's comment and check carry counts only", async () => {
    await setPrReceipts(world.db, owner, pid, { prReceipts: true });
    await receipt(pid, HEAD, "Secret roadmap item");
    const gh = fakeGithub();
    await runPrReceipt(world.db, event({ publicRepo: true }), step, gh.github, ORIGIN);
    const all = JSON.stringify(gh.calls);
    expect(all).toContain("| Missed | 1 |");
    expect(all).not.toContain("Secret roadmap");
    // Security review: a repository that became public or is internal gets counts only, whatever the webhook said.
    for (const visibility of ["public", "internal"]) {
      const flipped = fakeGithub({ visibility });
      await runPrReceipt(world.db, event({ publicRepo: false }), step, flipped.github, ORIGIN);
      expect(JSON.stringify(flipped.calls)).not.toContain("Secret roadmap");
    }
  });

  it("PH10B-14 the job re-checks: setting off, project unlinked or the App without permission post nothing", async () => {
    const gh = fakeGithub();
    expect(await runPrReceipt(world.db, event(), step, gh.github, ORIGIN)).toEqual({
      skipped: "off",
    });
    await setPrReceipts(world.db, owner, pid, { prReceipts: true });
    expect(
      await runPrReceipt(world.db, event({ installationId: 78 }), step, gh.github, ORIGIN),
    ).toEqual({ skipped: "not_linked" });
    expect(
      await runPrReceipt(world.db, event({ repo: "acme/other" }), step, gh.github, ORIGIN),
    ).toEqual({ skipped: "not_linked" });
    expect(gh.calls).toEqual([]);
    // A suspended project posts nothing either.
    await world.db.execute(sql`UPDATE "projects" SET "suspended_at" = now() WHERE id = ${pid}`);
    expect(await runPrReceipt(world.db, event(), step, gh.github, ORIGIN)).toEqual({
      skipped: "not_linked",
    });
    await world.db.execute(sql`UPDATE "projects" SET "suspended_at" = NULL WHERE id = ${pid}`);
    const denied = fakeGithub({ deny: /comments/ });
    expect(await runPrReceipt(world.db, event(), step, denied.github, ORIGIN)).toEqual({
      skipped: "no_permission",
    });
    const noChecks = fakeGithub({ deny: /check-runs/ });
    expect(await runPrReceipt(world.db, event(), step, noChecks.github, ORIGIN)).toMatchObject({
      comment: "created",
      check: false,
    });
  });

  it("PH10B-15 before migration 0056 the setting is off and cannot be changed", async () => {
    await world.db.execute(sql`DELETE FROM "_brain_migrations" WHERE id = '0056_project_settings'`);
    resetMigrationCheckForTests();
    expect(await projectSettingsView(world.db, owner, pid)).toMatchObject({
      ready: false,
      prReceipts: false,
    });
    await expect(setPrReceipts(world.db, owner, pid, { prReceipts: true })).rejects.toMatchObject({
      status: 503,
    });
    expect((await deliver(prBody())).status).toBe(200);
    expect(sent).toEqual([]);
  });
});
