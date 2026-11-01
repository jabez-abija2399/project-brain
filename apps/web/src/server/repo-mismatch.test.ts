import { POST as diffRoute } from "@/app/api/index/[projectId]/diff/route";
import { POST as rebuildRoute } from "@/app/api/index/[projectId]/rebuild/route";
import { GET as whoami } from "@/app/api/token/whoami/route";
import { fingerprintToken } from "@brain/core";
import { filesRepo, projectTokensRepo, projectsRepo, symbolsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findSimilarComponents } from "./components";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Real-test bug J (2026-11-01): the "stock" repository uploaded its 461 files into the first repo's project, and
// find_similar_component then answered with stock's design-system/src/components/button.tsx. The server now keeps
// the project's repository fingerprint (hashes only) and refuses another repository; a rebuild clears and re-adopts.
const APP = fingerprintToken({ root: "a".repeat(40), remote: "github.com/acme/app" });
const STOCK = fingerprintToken({ root: "b".repeat(40), remote: "github.com/acme/stock" });

let world: TestWorld;
let projectId: string;
let token: string;
beforeEach(async () => {
  world = await createTestWorld();
  const user = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, user.id, { name: "app" })).id;
  token = (await projectTokensRepo.create(world.db, projectId, "app")).token;
});
afterEach(async () => {
  await world.teardown();
});

const req = (path: string, repo: string | null, body?: unknown) =>
  new Request(`https://codeceipts.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(repo ? { "x-codeceipt-repo": repo } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = () => ({ params: Promise.resolve({ projectId }) });
const diff = (repo: string | null) =>
  diffRoute(
    req(`/api/index/${projectId}/diff`, repo, { files: [{ path: "a.ts", hash: "c".repeat(64) }] }),
    ctx(),
  );

describe("J: one project, one repository", () => {
  it("the project adopts the first repository; the same one keeps working; an older CLI without the header is not blocked", async () => {
    expect((await whoami(req("/api/token/whoami", APP))).status).toBe(200);
    expect(
      (await projectsRepo.get(world.db, projectId, (await world.createUser()).id))?.id,
    ).toBeUndefined();
    expect((await diff(APP)).status).toBe(200);
    expect((await diff(null)).status).toBe(200);
  });

  it("attack: the exact case — 'stock' gets 409 repo_mismatch on whoami and every upload, and nothing of it is stored", async () => {
    expect((await diff(APP)).status).toBe(200);
    const who = await whoami(req("/api/token/whoami", STOCK));
    expect(who.status).toBe(409);
    expect(await who.json()).toMatchObject({ code: "repo_mismatch" });
    const res = await diff(STOCK);
    expect(res.status).toBe(409);
    // A header that is not exactly the token shape is ignored, never trusted in part.
    expect((await diff("r=;o=;anything")).status).toBe(200);
  });

  it("index --rebuild: clears another repository's files, makes the caller's repository the project's, and find_similar_component no longer answers with them", async () => {
    // The state the bug left: stock's design-system button in the app's project.
    const stray = await filesRepo.insert(world.db, projectId, {
      path: "design-system/src/components/button.tsx",
      hash: "x",
    });
    await symbolsRepo.insertMany(world.db, projectId, [
      {
        fileId: stray.id,
        kind: "component",
        name: "Button",
        signature: null,
        summary: null,
        hash: "x",
      },
    ]);
    expect((await diff(STOCK)).status).toBe(200);
    expect(
      (await findSimilarComponents(world.db, projectId, "Button")).map((c) => c.path),
    ).toContain("design-system/src/components/button.tsx");
    // The app repository is refused now (the project took stock's fingerprint)...
    expect((await diff(APP)).status).toBe(409);
    // ...until it rebuilds: everything stored is cleared and the app's repository is the project's.
    const rebuilt = await rebuildRoute(req(`/api/index/${projectId}/rebuild`, APP, {}), ctx());
    expect(rebuilt.status).toBe(200);
    expect(await rebuilt.json()).toMatchObject({ ok: true, removed: 1 });
    expect(await findSimilarComponents(world.db, projectId, "Button")).toEqual([]);
    expect((await diff(APP)).status).toBe(200);
    expect((await diff(STOCK)).status).toBe(409);
  });

  it("attack: another project's token cannot rebuild this project (404, nothing cleared)", async () => {
    const other = await world.createUser({ name: "eve" });
    const theirs = (await projectsRepo.create(world.db, other.id, { name: "theirs" })).id;
    const theirToken = (await projectTokensRepo.create(world.db, theirs, null)).token;
    await filesRepo.insert(world.db, projectId, { path: "src/a.ts", hash: "a" });
    const res = await rebuildRoute(
      new Request(`https://codeceipts.test/api/index/${projectId}/rebuild`, {
        method: "POST",
        headers: { authorization: `Bearer ${theirToken}`, "content-type": "application/json" },
        body: "{}",
      }),
      ctx(),
    );
    expect(res.status).toBe(404);
    expect(await findSimilarComponents(world.db, projectId, "a")).toBeDefined();
  });
});
