import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Launch part 4: every state-changing dashboard request (session cookie) must come from the app's own pages. Each
// route is found by reading the source, so a new route cannot be forgotten.
const appDir = fileURLToPath(new URL("../app", import.meta.url));
const APP = "https://codeceipts.test";
const UNSAFE = ["POST", "PATCH", "PUT", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });
}

// Session routes: they resolve the signed-in user with requireUser and export a state-changing method.
const sessionRoutes = routeFiles(join(appDir, "api")).flatMap((file) => {
  const source = readFileSync(file, "utf8");
  if (!source.includes("requireUser(")) return [];
  return UNSAFE.filter((m) =>
    new RegExp(`export (?:async function |const (?:\\{[^}]*\\b)?)${m}\\b`).test(source),
  ).map((method) => ({ file, method }));
});

let world: TestWorld;
let owner: SessionUser;
let projectId: string;

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "Shop" })).id;
  world.signInAs(owner);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await world.teardown();
});

async function call(file: string, method: string, headers: Record<string, string>) {
  const mod = (await import(file)) as Record<
    string,
    (req: Request, ctx: unknown) => Promise<Response>
  >;
  const handler = mod[method];
  if (!handler) throw new Error(`${file} has no ${method}`);
  const params = { id: projectId, itemId: "x", fid: "x", did: "x", tokenId: "x", projectId };
  return handler(
    new Request(`${APP}/api/x`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ name: "Renamed" }),
    }),
    { params: Promise.resolve(params) },
  );
}

describe("Origin check on state-changing dashboard requests", () => {
  it("finds the session routes that change state", () => {
    const names = sessionRoutes.map((r) => `${r.method} ${relative(appDir, r.file)}`);
    expect(names.length).toBeGreaterThanOrEqual(8);
    expect(names).toContain("POST api/projects/route.ts");
    expect(names).toContain("POST api/device/approve/route.ts");
    expect(names).toContain("POST api/projects/[id]/plan/approve/route.ts");
  });

  it("attack: every one of them refuses another site's Origin with 403, before doing anything", async () => {
    for (const { file, method } of sessionRoutes) {
      const res = await call(file, method, { origin: "https://evil.test" });
      expect([relative(appDir, file), method, res.status]).toEqual([
        relative(appDir, file),
        method,
        403,
      ]);
      expect(((await res.json()) as { code: string }).code).toBe("bad_origin");
    }
    // Nothing changed: the project is still called Shop.
    expect((await projectsRepo.get(world.db, projectId, owner.id))?.name).toBe("Shop");
  });

  it("attack: an opaque Origin (null) or, without Origin, a foreign Referer is refused too", async () => {
    const route = join(appDir, "api/projects/[id]/route.ts");
    expect((await call(route, "PATCH", { origin: "null" })).status).toBe(403);
    expect((await call(route, "PATCH", { referer: "https://evil.test/page" })).status).toBe(403);
    expect(
      (await call(route, "PATCH", { origin: "https://codeceipts.test.evil.test" })).status,
    ).toBe(403);
    expect((await projectsRepo.get(world.db, projectId, owner.id))?.name).toBe("Shop");
  });

  it("the app's own pages still work (same Origin), and so do clients that send no Origin or Referer", async () => {
    const route = join(appDir, "api/projects/[id]/route.ts");
    const same = await call(route, "PATCH", { origin: APP });
    expect(same.status).toBe(200);
    expect((await projectsRepo.get(world.db, projectId, owner.id))?.name).toBe("Renamed");
    const viaReferer = await call(route, "PATCH", { referer: `${APP}/projects/${projectId}` });
    expect(viaReferer.status).toBe(200);
    const noHeaders = await call(route, "PATCH", {});
    expect(noHeaders.status).toBe(200);
  });
});
