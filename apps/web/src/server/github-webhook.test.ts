import { POST } from "@/app/api/github/webhook/route";
import { githubRepo, projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GithubConfig } from "./github";
import { makeGithubConfig, restoreGithub, sign } from "./github-test-helpers";
import { PUSH_EVENT, type PushEventData, setEventSenderForTests } from "./inngest";
import { type TestWorld, createTestWorld } from "./test-helpers";

const BEFORE = "a".repeat(40);
const AFTER = "b".repeat(40);

let world: TestWorld;
let config: GithubConfig;
let projectId: string;
let sent: { name: string; data: PushEventData }[];
let deliveryCounter = 0;

beforeEach(async () => {
  world = await createTestWorld();
  config = makeGithubConfig();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "app" })).id;
  await githubRepo.linkProject(world.db, projectId, owner.id, 77, "acme/app");
  sent = [];
  setEventSenderForTests(async (events) => {
    sent.push(...events);
  });
});

afterEach(async () => {
  setEventSenderForTests(undefined);
  restoreGithub();
  await world.teardown();
});

const pushBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    ref: "refs/heads/main",
    before: BEFORE,
    after: AFTER,
    repository: { full_name: "acme/app", default_branch: "main" },
    installation: { id: 77 },
    ...over,
  });

function deliver(
  body: string,
  opts: { event?: string; delivery?: string; signature?: string | null } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": opts.event ?? "push",
    "x-github-delivery": opts.delivery ?? `delivery-${++deliveryCounter}`,
  };
  const signature =
    opts.signature === undefined ? sign(body, config.webhookSecret) : opts.signature;
  if (signature !== null) headers["x-hub-signature-256"] = signature;
  return POST(
    new Request("http://localhost/api/github/webhook", { method: "POST", headers, body }),
  );
}

describe("POST /api/github/webhook (FEAT-009)", () => {
  it("AC-009-02 a signed push to the default branch enqueues one job for the linked project within 2 s", async () => {
    const started = performance.now();
    const res = await deliver(pushBody(), { delivery: "push-1" });
    const ms = performance.now() - started;
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, enqueued: true });
    expect(sent).toEqual([
      {
        name: PUSH_EVENT,
        data: {
          projectId,
          installationId: 77,
          repo: "acme/app",
          before: BEFORE,
          after: AFTER,
          deliveryId: "push-1",
        },
      },
    ]);
    expect(ms).toBeLessThan(2000);
  });

  it("AC-009-02 a push to another branch, of an unlinked repo or deleting the branch enqueues nothing", async () => {
    for (const body of [
      pushBody({ ref: "refs/heads/feature" }),
      pushBody({ repository: { full_name: "acme/other", default_branch: "main" } }),
      pushBody({ installation: { id: 78 } }),
      pushBody({ deleted: true }),
    ]) {
      const res = await deliver(body);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, enqueued: false });
    }
    expect(sent).toEqual([]);
  });

  it("AC-009-03 attack: a missing, wrong or malformed signature is 401 and enqueues nothing", async () => {
    const body = pushBody();
    const wrongSecret = sign(body, "not-the-secret");
    const otherBody = sign(pushBody({ after: "c".repeat(40) }), config.webhookSecret);
    for (const signature of [null, "", wrongSecret, otherBody, "sha1=abc", "sha256=zz"]) {
      const res = await deliver(body, { signature });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "bad_signature" });
    }
    expect(sent).toEqual([]);
  });

  it("AC-009-03 attack: an unsigned body is never parsed (invalid JSON still gets 401, not 400)", async () => {
    const res = await deliver("{not json", { signature: sign("{}", config.webhookSecret) });
    expect(res.status).toBe(401);
    expect(sent).toEqual([]);
  });

  it("AC-009-04 attack: a replayed delivery id is ignored and processed at most once", async () => {
    const body = pushBody();
    const first = await deliver(body, { delivery: "replay-1" });
    expect(first.status).toBe(202);
    const replay = await deliver(body, { delivery: "replay-1" });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true, duplicate: true });
    expect(sent).toHaveLength(1);
  });

  it("AC-009-04 a failed enqueue forgets the delivery, so GitHub's redelivery is processed", async () => {
    setEventSenderForTests(async () => {
      throw new Error("inngest down");
    });
    expect((await deliver(pushBody(), { delivery: "retry-1" })).status).toBe(503);
    setEventSenderForTests(async (events) => {
      sent.push(...events);
    });
    expect((await deliver(pushBody(), { delivery: "retry-1" })).status).toBe(202);
    expect(sent).toHaveLength(1);
  });

  it("AC-009-02 ping is 200, an unhandled event is 400, an uninstall unlinks the project", async () => {
    expect((await deliver("{}", { event: "ping" })).status).toBe(200);
    expect((await deliver("{}", { event: "issues" })).status).toBe(400);
    const uninstall = JSON.stringify({ action: "deleted", installation: { id: 77 } });
    expect((await deliver(uninstall, { event: "installation" })).status).toBe(200);
    expect(await githubRepo.linkedProjects(world.db, 77, "acme/app")).toEqual([]);
    expect((await deliver(pushBody())).status).toBe(200);
    expect(sent).toEqual([]);
  });
});
