import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { POST as startRoute } from "@/app/api/device/start/route";
import { POST as diff } from "@/app/api/index/[projectId]/diff/route";
import { POST as group } from "@/app/api/index/[projectId]/features/route";
import { POST as upload } from "@/app/api/index/[projectId]/route";
import { POST as summarize } from "@/app/api/index/[projectId]/summarize/route";
import { GET as whoami } from "@/app/api/token/whoami/route";
import { type CliDeps, main } from "@brain/cli";
import { filesRepo, projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { approveDevice, pollDevice } from "./device";
import { setLlmForTests } from "./llm";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Launch part 1: `npx codeceipt` with no arguments, end to end against the real route handlers (PGlite behind them).
const API = "https://codeceipts.test";
const fixture = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
  "tests/fixtures/component-app",
);

type Handler = (req: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>;
const indexRoutes: [RegExp, Handler][] = [
  [/^\/api\/index\/([^/]+)\/diff$/, diff],
  [/^\/api\/index\/([^/]+)\/summarize$/, summarize],
  [/^\/api\/index\/([^/]+)\/features$/, group],
  [/^\/api\/index\/([^/]+)$/, upload],
];

let world: TestWorld;
let owner: SessionUser;
let clock: number;

// The CLI's fetch, routed in process. The token route runs on a virtual clock that the CLI's sleep moves forward, so
// the real polling rules (interval, expiry) apply without waiting.
function serverFetch() {
  const paths: string[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const req = new Request(url, init);
    const path = new URL(req.url).pathname;
    paths.push(path);
    if (path === "/api/device/start") return startRoute(req);
    if (path === "/api/device/token") {
      const result = await pollDevice(world.db, req, await req.json(), new Date(clock));
      return Response.json(result.body, { status: result.status });
    }
    if (path === "/api/token/whoami") return whoami(req);
    for (const [re, handler] of indexRoutes) {
      const m = path.match(re);
      if (m?.[1]) return handler(req, { params: Promise.resolve({ projectId: m[1] }) });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, paths };
}

function gitRepo() {
  const repo = mkdtempSync(join(tmpdir(), "cc-setup-"));
  cpSync(fixture, repo, { recursive: true });
  mkdirSync(join(repo, ".claude"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return repo;
}

function cli(
  repo: string,
  fetchImpl: CliDeps["fetch"],
  openUrl: (url: string) => Promise<boolean>,
  home = mkdtempSync(join(tmpdir(), "cc-setup-home-")),
) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    fetch: fetchImpl,
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), CODECEIPT_API_URL: API },
    cwd: repo,
    homedir: home,
    platform: "linux",
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    readStdin: async () => "",
    sleep: async (ms) => {
      clock += ms;
    },
    openUrl,
  };
  return { home, out, err, run: (...argv: string[]) => main(argv, deps) };
}

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", API);
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  clock = Date.now();
  setLlmForTests(null);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setLlmForTests(undefined);
  await world.teardown();
});

describe("npx codeceipt (no arguments) sets everything up", () => {
  it("opens the approval page with the code, gets a token once approved, links the repo, indexes, runs init and prints one summary", async () => {
    const repo = gitRepo();
    const s = serverFetch();
    let opened = "";
    const c = cli(repo, s.fetchImpl, async (url) => {
      opened = url;
      // The signed-in user approves the code shown on the page, creating a project named after the repo.
      const code = new URL(url).searchParams.get("code") ?? "";
      await approveDevice(world.db, owner, { user_code: code, new_project_name: "component-app" });
      return true;
    });
    expect(await c.run()).toBe(0);
    expect(c.err).toEqual([]);

    const code = new URL(opened).searchParams.get("code") ?? "";
    expect(opened).toBe(`${API}/device?code=${code}`);
    expect(code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    // The same code is shown in the terminal.
    expect(c.out[0]).toBe(`Your code: ${code}`);

    const projects = await projectsRepo.listByOwner(world.db, owner.id);
    const project = projects.items.find((p) => p.name === "component-app");
    expect(project).toBeDefined();
    const projectId = project?.id ?? "";
    // The repo is linked to that project; the token is in the user config only.
    const link = JSON.parse(readFileSync(join(repo, ".git", "codeceipt", "project.json"), "utf8"));
    expect(link).toEqual({ apiUrl: API, projectId });
    const config = readFileSync(join(c.home, ".config", "codeceipt", "config.json"), "utf8");
    expect(config).toContain(projectId);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo }).toString()).not.toContain(
      "codeceipt/project.json",
    );
    // Indexed into that project, and init set up Claude Code.
    expect((await filesRepo.list(world.db, projectId)).length).toBeGreaterThan(0);
    expect(existsSync(join(repo, ".mcp.json"))).toBe(true);
    expect(existsSync(join(repo, ".claude", "settings.json"))).toBe(true);
    // One short summary at the end (no index or init detail).
    expect(c.out.slice(-5)).toEqual([
      "Codeceipt is set up for this repo.",
      `  Project: ${API}/projects/${projectId}`,
      expect.stringMatching(/^ {2}Indexed: \d+ files?/),
      "  Agents:  Claude Code",
      "  Next:    start a Claude Code or Cursor session here; receipts appear in your dashboard.",
    ]);
    expect(c.out.length).toBeLessThanOrEqual(9);
  });

  it("prints the address to visit when no browser can open, and a second run reuses the link without a new code", async () => {
    const repo = gitRepo();
    const s = serverFetch();
    let printed = "";
    const project = await projectsRepo.create(world.db, owner.id, { name: "app" });
    const c = cli(repo, s.fetchImpl, async (url) => {
      // No browser here: the user opens the printed address on another device and approves there.
      printed = url;
      const code = new URL(url).searchParams.get("code") ?? "";
      await approveDevice(world.db, owner, { user_code: code, project_id: project.id });
      return false;
    });
    expect(await c.run()).toBe(0);
    expect(c.out).toContain(`Open this address in your browser: ${printed}`);
    expect(c.out).not.toContain(`Opened the approval page in your browser: ${printed}`);

    // Second run on the same machine: already linked with a working token, so no new code and no browser.
    const again = cli(
      repo,
      s.fetchImpl,
      async () => {
        throw new Error("must not open a browser");
      },
      c.home,
    );
    expect(await again.run()).toBe(0);
    expect(s.paths.filter((p) => p === "/api/device/start")).toHaveLength(1);
    expect(again.out[0]).toBe(`This repo is already connected to project ${project.id}.`);
    expect(again.out.at(-5)).toBe("Codeceipt is set up for this repo.");
  });

  it("refuses outside a git repository, before asking for any code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-nogit-"));
    const s = serverFetch();
    const c = cli(dir, s.fetchImpl, async () => true);
    expect(await c.run()).toBe(2);
    expect(c.err).toEqual([
      "Run `npx codeceipt` inside your app's git repository (run `git init` there first if it has none).",
    ]);
    expect(s.paths).toEqual([]);
  });

  it("stops with a clear message when the code is denied or expires", async () => {
    const repo = gitRepo();
    const s = serverFetch();
    const denied = cli(repo, s.fetchImpl, async (url) => {
      const code = new URL(url).searchParams.get("code") ?? "";
      await approveDevice(world.db, owner, { user_code: code, deny: true });
      return true;
    });
    expect(await denied.run()).toBe(3);
    expect(denied.err).toEqual(["The code was denied in the browser; nothing was connected."]);
    expect(existsSync(join(repo, ".git", "codeceipt", "project.json"))).toBe(false);

    const expired = cli(repo, s.fetchImpl, async () => true);
    expect(await expired.run()).toBe(3);
    expect(expired.err).toEqual([
      "The code expired before it was approved: run `npx codeceipt` again.",
    ]);
  });
});
