import { GET as openItemsRoute } from "@/app/api/hooks/[projectId]/open-items/route";
import { POST as captureRoute } from "@/app/api/hooks/[projectId]/requests/route";
import type { CompleteRequest, Llm } from "@brain/core";
import {
  checklistItemsRepo,
  featuresRepo,
  projectTokensRepo,
  projectsRepo,
  requestsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChecklist } from "./checklist";
import { setLlmForTests } from "./llm";
import { whereDidWeStop } from "./session-tools";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Requests captured by the agents' prompt-submit hooks, tied to the agent session they were made in.
let world: TestWorld;
let projectId: string;
let token: string;
let tokenRow: { id: string; projectId: string };
let reviews: { id: string };
let calls: CompleteRequest[];
let answer: string;

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "edutech" })).id;
  const created = await projectTokensRepo.create(world.db, projectId);
  token = created.token;
  tokenRow = created.row;
  await featuresRepo.insert(world.db, projectId, { name: "home", key: "@home" });
  reviews = await featuresRepo.insert(world.db, projectId, { name: "Reviews", key: "reviews" });
  calls = [];
  answer = "FEATURE: Reviews\n- Add a star rating\n- Show the average";
  const llm: Llm = {
    async complete(req) {
      calls.push(req);
      return answer;
    },
  };
  setLlmForTests(llm);
});
afterEach(async () => {
  setLlmForTests(undefined);
  vi.unstubAllEnvs();
  await world.teardown();
});

const capture = (body: unknown, id = projectId, bearer = token) =>
  captureRoute(
    new Request(`http://localhost/api/hooks/${id}/requests`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId: id }) },
  );
const openItems = (query: string, id = projectId, bearer = token) =>
  openItemsRoute(
    new Request(`http://localhost/api/hooks/${id}/open-items${query}`, {
      headers: { authorization: `Bearer ${bearer}` },
    }),
    { params: Promise.resolve({ projectId: id }) },
  );

describe("captured requests", () => {
  it("records the request on the feature the AI picks, split into items, tied to the session, with one AI call", async () => {
    const res = await capture({ text: "Add star ratings to reviews", session_id: "sess-1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, recorded: true, feature: "Reviews", items: 2 });
    const [stored] = await requestsRepo.list(world.db, projectId);
    expect(stored).toMatchObject({ featureId: reviews.id, sessionId: "sess-1" });
    expect(calls.map((c) => c.purpose)).toEqual(["request-capture"]);
  });

  it("a message that is not a request, or the same text again in the session, records nothing new", async () => {
    answer = "NOT A REQUEST";
    expect(await (await capture({ text: "thanks!", session_id: "sess-1" })).json()).toMatchObject({
      recorded: false,
    });
    expect(await requestsRepo.list(world.db, projectId)).toEqual([]);
    answer = "FEATURE: Reviews\n- Add a star rating";
    await capture({ text: "Add star ratings", session_id: "sess-1" });
    await capture({ text: "Add star ratings", session_id: "sess-1" });
    expect(await requestsRepo.list(world.db, projectId)).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("the daily AI budget counts each capture; when it is used up the request is still kept, unsplit", async () => {
    vi.stubEnv("AI_CALLS_PER_PROJECT_PER_DAY", "1");
    await capture({ text: "Add star ratings", session_id: "sess-1" });
    const res = await capture({ text: "Add a review form", session_id: "sess-1" });
    expect(await res.json()).toMatchObject({ recorded: true, items: 0 });
    expect(calls).toHaveLength(1);
    expect(await requestsRepo.list(world.db, projectId)).toHaveLength(2);
  });

  it("create_checklist for a request the hook already captured returns it, with no second AI call", async () => {
    await capture({ text: "Add star ratings to reviews", session_id: "sess-1" });
    const again = await createChecklist(world.db, tokenRow, {
      feature: "Reviews",
      request: "Add star ratings to reviews",
    });
    expect(again.items).toHaveLength(2);
    expect(await requestsRepo.list(world.db, projectId)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("attack: secrets are masked, the text is capped, and bad input or another project's token is refused", async () => {
    const secret = ["sk_", "live_", "4eC39Hq", "LyjWDarj", "Ab12"].join("");
    await capture({ text: `Use ${secret} and ${"x".repeat(9000)}`, session_id: "sess-1" });
    const [stored] = await requestsRepo.list(world.db, projectId);
    expect(stored?.text).not.toContain(secret);
    expect(stored?.text.length).toBeLessThanOrEqual(4000);
    expect(calls[0]?.prompt).not.toContain(secret);
    for (const bad of [
      { text: "", session_id: "s" },
      { text: "   ", session_id: "s" },
      { text: "a\u0000b", session_id: "s" },
      { text: "x", session_id: "../etc" },
      { text: "x", session_id: "s", projectId: "other" },
      "not json",
    ]) {
      expect((await capture(bad)).status).toBe(400);
    }
    const other = await projectsRepo.create(world.db, (await world.createUser()).id, { name: "b" });
    const otherToken = (await projectTokensRepo.create(world.db, other.id)).token;
    expect((await capture({ text: "steal", session_id: "s" }, projectId, otherToken)).status).toBe(
      404,
    );
  });
});

describe("requests tied to sessions", () => {
  it("open-items for a session lists only that session's requests; earlier ones stay out of its receipt", async () => {
    await capture({ text: "Earlier request", session_id: "old" });
    await capture({ text: "This session's request", session_id: "new" });
    const body = await (await openItems("?session=new")).json();
    expect(body.session_requests.map((r: { text: string }) => r.text)).toEqual([
      "This session's request",
    ]);
    // The session-end warning about loose items still sees every open request.
    expect(body.requests).toHaveLength(2);
  });

  it("a request recorded without a session (create_checklist) counts for the session that started before it", async () => {
    const sessionStart = new Date(Date.now() - 60_000).toISOString();
    await createChecklist(world.db, tokenRow, {
      feature: "Reviews",
      request: "Agent-recorded request",
    });
    const body = await (
      await openItems(`?session=s9&since=${encodeURIComponent(sessionStart)}`)
    ).json();
    expect(body.session_requests.map((r: { text: string }) => r.text)).toEqual([
      "Agent-recorded request",
    ]);
    const later = await (
      await openItems(
        `?session=s9&since=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`,
      )
    ).json();
    expect(later.session_requests).toEqual([]);
  });

  it("the start note lists earlier sessions' open items as Still open from earlier", async () => {
    await capture({ text: "Add star ratings", session_id: "old" });
    const note = await whereDidWeStop(world.db, tokenRow, {});
    expect(note).toContain("STILL OPEN FROM EARLIER:");
    expect(note).toContain("- Add a star rating");
    expect(note).not.toContain("OPEN CHECKLIST:");
    expect((await checklistItemsRepo.listOpenForProject(world.db, projectId, 20)).length).toBe(2);
  });

  it("attack: a session id with odd characters or another project's session never reaches other requests", async () => {
    await capture({ text: "Mine", session_id: "abc" });
    for (const q of [
      "?session=%27%20OR%201%3D1",
      "?session=abc%25",
      "?session=",
      "?since=nonsense",
    ]) {
      const res = await openItems(q);
      const body = await res.json();
      expect([q, body.session_requests ?? []]).toEqual([q, []]);
    }
  });
});
