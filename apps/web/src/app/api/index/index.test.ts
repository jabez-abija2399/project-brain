import { createHash } from "node:crypto";
import { POST as diff } from "@/app/api/index/[projectId]/diff/route";
import { POST as upload } from "@/app/api/index/[projectId]/route";
import { POST as summarize } from "@/app/api/index/[projectId]/summarize/route";
import { setLlmForTests } from "@/server/llm";
import { resetRateLimitsForTests } from "@/server/rate-limit";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import type { Llm } from "@brain/core";
import { filesRepo, projectTokensRepo, projectsRepo, symbolsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (req: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>;

function call(handler: Handler, projectId: string, token: string, body: unknown) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return handler(
    new Request(`http://x/api/index/${projectId}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: raw,
    }),
    { params: Promise.resolve({ projectId }) },
  );
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const file = (path: string, names: string[] = ["Widget"]) => ({
  path,
  hash: sha(path),
  symbols: names.map((name) => ({ kind: "component", name, signature: "({ a }) => JSX" })),
});

function fakeLlm(answer: () => Promise<string> = async () => "Renders a widget.") {
  const prompts: string[] = [];
  const llm: Llm = {
    async complete(req) {
      prompts.push(req.prompt);
      return answer();
    },
  };
  return { llm, prompts };
}

describe("FEAT-008 /api/index", () => {
  let world: TestWorld;
  let a: { id: string; token: string };
  let b: { id: string; token: string };

  beforeEach(async () => {
    world = await createTestWorld();
    resetRateLimitsForTests();
    const user = await world.createUser();
    const other = await world.createUser();
    const pa = await projectsRepo.create(world.db, user.id, { name: "a" });
    const pb = await projectsRepo.create(world.db, other.id, { name: "b" });
    a = { id: pa.id, token: (await projectTokensRepo.create(world.db, pa.id)).token };
    b = { id: pb.id, token: (await projectTokensRepo.create(world.db, pb.id)).token };
  });
  afterEach(async () => {
    setLlmForTests(null);
    vi.useRealTimers();
    await world.teardown();
  });

  it("AC-008-04 a token for project B posting to project A gets 404 on every index route and stores nothing", async () => {
    setLlmForTests(fakeLlm().llm);
    const batch = { files: [file("src/A.tsx")] };
    expect((await call(upload, a.id, b.token, batch)).status).toBe(404);
    expect(
      (await call(diff, a.id, b.token, { files: [{ path: "src/A.tsx", hash: sha("x") }] })).status,
    ).toBe(404);
    expect((await call(summarize, a.id, b.token, {})).status).toBe(404);
    expect((await call(upload, "no-such-project", b.token, batch)).status).toBe(404);
    expect((await call(upload, a.id, "pb_not-a-token", batch)).status).toBe(401);
    expect(await filesRepo.list(world.db, a.id)).toEqual([]);
    expect(await filesRepo.list(world.db, b.id)).toEqual([]);
    // The right token works.
    expect((await call(upload, a.id, a.token, batch)).status).toBe(200);
    expect((await filesRepo.list(world.db, a.id)).map((f) => f.path)).toEqual(["src/A.tsx"]);
  });

  it("AC-008-05 more than 200 files or a body over 5 MB in one batch is rejected with 413 and stores nothing", async () => {
    const files = Array.from({ length: 201 }, (_, i) => file(`src/F${i}.tsx`));
    const many = await call(upload, a.id, a.token, { files });
    expect(many.status).toBe(413);
    const manyDiff = await call(diff, a.id, a.token, {
      files: files.map((f) => ({ path: f.path, hash: f.hash })),
    });
    expect(manyDiff.status).toBe(413);
    const big = JSON.stringify({ files: [file("src/A.tsx")], pad: "x".repeat(5 * 1024 * 1024) });
    expect((await call(upload, a.id, a.token, big)).status).toBe(413);
    expect(await filesRepo.list(world.db, a.id)).toEqual([]);
    // Exactly 200 files is accepted.
    expect((await call(upload, a.id, a.token, { files: files.slice(0, 200) })).status).toBe(200);
  });

  it("AC-008-03 the upload schema has no field for source text and rejects unsafe paths", async () => {
    const bad = [
      { files: [{ ...file("src/A.tsx"), content: "export const a = 1;" }] },
      {
        files: [
          {
            ...file("src/A.tsx"),
            symbols: [{ kind: "component", name: "A", signature: "", source: "x" }],
          },
        ],
      },
      { files: [file("../outside.tsx")] },
      { files: [file("/etc/passwd")] },
      { files: [file("src/../../x.tsx")] },
      { files: [file("C:\\x.tsx")] },
    ];
    for (const body of bad) expect((await call(upload, a.id, a.token, body)).status).toBe(400);
    expect(await filesRepo.list(world.db, a.id)).toEqual([]);
  });

  it("KI-022 an upload keeps the summary and attempt state of components whose hash did not change", async () => {
    const fake = fakeLlm();
    setLlmForTests(fake.llm);
    await call(upload, a.id, a.token, { files: [file("src/A.tsx", ["Card", "Badge"])] });
    const first = await (await call(summarize, a.id, a.token, {})).json();
    expect(first).toMatchObject({ ok: true, attempted: 2, remaining: 0 });
    // The file changed (new hash) but only Badge's signature did: one new call.
    const changed = file("src/A.tsx", ["Card", "Badge"]);
    changed.hash = sha("new");
    changed.symbols[1] = { kind: "component", name: "Badge", signature: "({ tone }) => JSX" };
    await call(upload, a.id, a.token, { files: [changed] });
    await call(summarize, a.id, a.token, {});
    expect(fake.prompts).toHaveLength(3);
    const rows = await symbolsRepo.listComponents(world.db, a.id);
    expect(rows.map((r) => [r.name, r.summary, r.summaryAttempts]).sort()).toEqual([
      ["Badge", "Renders a widget.", 1],
      ["Card", "Renders a widget.", 1],
    ]);
  });

  it("(4) summary_attempted_at comes from the server clock, never from the client", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    setLlmForTests(fakeLlm().llm);
    const withClientTime = {
      files: [
        {
          ...file("src/A.tsx"),
          symbols: [
            {
              kind: "component",
              name: "A",
              signature: "",
              summaryAttemptedAt: "2001-01-01T00:00:00Z",
            },
          ],
        },
      ],
    };
    expect((await call(upload, a.id, a.token, withClientTime)).status).toBe(400);
    expect((await call(upload, a.id, a.token, { files: [file("src/A.tsx")] })).status).toBe(200);
    const res = await summarize(
      new Request(`http://x/api/index/${a.id}/summarize`, {
        method: "POST",
        headers: { authorization: `Bearer ${a.token}`, date: "Mon, 01 Jan 2001 00:00:00 GMT" },
        body: JSON.stringify({ now: "2001-01-01T00:00:00Z" }),
      }),
      { params: Promise.resolve({ projectId: a.id }) },
    );
    expect(res.status).toBe(200);
    const [row] = await symbolsRepo.listComponents(world.db, a.id);
    expect(row?.summaryAttemptedAt?.toISOString()).toBe("2026-10-28T12:00:00.000Z");
  });

  it("summarize is bounded per request and reports what is left; without an AI key it makes no calls", async () => {
    const files = [
      file(
        "src/A.tsx",
        Array.from({ length: 50 }, (_, i) => `W${i}`),
      ),
    ];
    await call(upload, a.id, a.token, { files });
    setLlmForTests(null);
    expect(await (await call(summarize, a.id, a.token, {})).json()).toMatchObject({
      ok: true,
      attempted: 0,
      remaining: 50,
      enabled: false,
    });
    const fake = fakeLlm();
    setLlmForTests(fake.llm);
    expect(await (await call(summarize, a.id, a.token, {})).json()).toMatchObject({
      attempted: 40,
      remaining: 10,
    });
    expect(await (await call(summarize, a.id, a.token, {})).json()).toMatchObject({
      attempted: 10,
      remaining: 0,
    });
    expect(fake.prompts).toHaveLength(50);
  });

  it("the diff returns only paths whose hash changed or that are new", async () => {
    await call(upload, a.id, a.token, { files: [file("src/A.tsx"), file("src/B.tsx")] });
    const res = await call(diff, a.id, a.token, {
      files: [
        { path: "src/A.tsx", hash: sha("src/A.tsx") },
        { path: "src/B.tsx", hash: sha("changed") },
        { path: "src/C.tsx", hash: sha("new") },
      ],
    });
    expect(await res.json()).toEqual({ ok: true, changed: ["src/B.tsx", "src/C.tsx"] });
  });

  it("more than 60 index requests a minute with one token get 429", async () => {
    const body = { files: [{ path: "src/A.tsx", hash: sha("x") }] };
    for (let i = 0; i < 60; i++) expect((await call(diff, a.id, a.token, body)).status).toBe(200);
    expect((await call(diff, a.id, a.token, body)).status).toBe(429);
    expect((await call(diff, b.id, b.token, body)).status).toBe(200);
  });
});
