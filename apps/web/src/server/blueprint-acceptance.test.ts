// @slow: end-to-end or process-spawning test; skipped in quick mode unless its package changed
// Roadmap Phase 3c acceptance: a realistic Next.js + Supabase app and a Vite (Lovable-style) app, indexed by the real
// CLI into the real routes, then shown by Discover and the safety check. Paths, names and flags only: no source code.
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { POST as diff } from "@/app/api/index/[projectId]/diff/route";
import { POST as group } from "@/app/api/index/[projectId]/features/route";
import { POST as upload } from "@/app/api/index/[projectId]/route";
import { POST as summarize } from "@/app/api/index/[projectId]/summarize/route";
import { POST as supabase } from "@/app/api/index/[projectId]/supabase/route";
import { GET as whoami } from "@/app/api/token/whoami/route";
import { type CliDeps, main } from "@brain/cli";
import type { Llm } from "@brain/core";
import { projectTokensRepo, projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth";
import { discoverPage } from "./blueprint-page";
import { setLlmForTests } from "./llm";
import { type TestWorld, createTestWorld } from "./test-helpers";

const FIXTURES = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
  "tests/fixtures",
);

type Handler = (req: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>;
const ROUTES: [RegExp, Handler][] = [
  [/^\/api\/index\/([^/]+)\/diff$/, diff],
  [/^\/api\/index\/([^/]+)\/summarize$/, summarize],
  [/^\/api\/index\/([^/]+)\/features$/, group],
  [/^\/api\/index\/([^/]+)\/supabase$/, supabase],
  [/^\/api\/index\/([^/]+)$/, upload],
];
const fetchImpl: CliDeps["fetch"] = async (url, init) => {
  const req = new Request(url, init);
  const path = new URL(req.url).pathname;
  if (path === "/api/token/whoami") return whoami(req);
  for (const [re, handler] of ROUTES) {
    const m = path.match(re);
    if (m?.[1]) return handler(req, { params: Promise.resolve({ projectId: m[1] }) });
  }
  return new Response("not found", { status: 404 });
};

let world: TestWorld;
let owner: SessionUser;

async function indexed(app: string, migrations?: string) {
  const pid = (await projectsRepo.create(world.db, owner.id, { name: app })).id;
  const token = (await projectTokensRepo.create(world.db, pid)).token;
  const repo = mkdtempSync(join(tmpdir(), "bp-accept-"));
  cpSync(join(FIXTURES, app), repo, { recursive: true });
  if (migrations) {
    mkdirSync(join(repo, "supabase"), { recursive: true });
    cpSync(join(FIXTURES, migrations), join(repo, "supabase/migrations"), { recursive: true });
  }
  const home = mkdtempSync(join(tmpdir(), "bp-home-"));
  const deps: CliDeps = {
    fetch: fetchImpl,
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), NO_COLOR: "1" },
    cwd: repo,
    homedir: home,
    platform: "linux",
    stdout: () => {},
    stderr: () => {},
    readStdin: async () => `${token}\n`,
  };
  expect(await main(["login", "--api-url", "https://brain.test"], deps)).toBe(0);
  expect(await main(["index"], deps)).toBe(0);
  return discoverPage(world.db, owner, pid);
}

beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  setLlmForTests({ complete: async () => "Renders part of the page." } satisfies Llm);
});
afterEach(async () => {
  setLlmForTests(null);
  await world.teardown();
});

describe("Phase 3c acceptance on realistic fixtures", () => {
  it("BP-3C-07 Next.js + Supabase: Discover shows the routes and next feature; the safety check finds the open tables", async () => {
    const view = await indexed("next-app", "supabase/realistic/migrations");
    if (!view.ready) throw new Error("not ready");
    const routes = view.discover.features.flatMap((f) => f.routes);
    expect(routes).toEqual(expect.arrayContaining(["/api/health", "/reviews/[id]"]));
    expect(view.discover.next).not.toBeNull();
    expect(view.discover.features.every((f) => !f.confirmed)).toBe(true);
    const api = view.discover.features.find((f) => f.routes.includes("/api/health"));
    expect(api?.suggestions.map((s) => s.kind)).toEqual(["must_never", "security"]);
    expect(view.safety.tablesChecked).toBeGreaterThan(0);
    const kinds = view.safety.risks.map((r) => r.kind);
    expect(kinds).toContain("no_must_never");
    expect(kinds.some((k) => k.startsWith("rls") || k === "policy_allows_everyone_to_write")).toBe(
      true,
    );
    expect(JSON.stringify(view)).not.toMatch(/create table|insert into|export function/i);
  });

  it("BP-3C-08 Vite (Lovable-style): Discover shows its pages and components without any Next.js routes", async () => {
    const view = await indexed("vite-app");
    if (!view.ready) throw new Error("not ready");
    expect(view.discover.features.length).toBeGreaterThan(0);
    const components = view.discover.features.flatMap((f) => f.components);
    expect(components.length).toBeGreaterThan(0);
    expect(view.discover.features.flatMap((f) => f.routes)).not.toContain("/api/health");
    expect(view.safety.tablesChecked).toBe(0);
    expect(view.safety.risks.map((r) => r.kind)).toEqual(["no_must_never"]);
  });
});
