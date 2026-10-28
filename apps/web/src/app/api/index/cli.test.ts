import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { POST as diff } from "@/app/api/index/[projectId]/diff/route";
import { POST as upload } from "@/app/api/index/[projectId]/route";
import { POST as summarize } from "@/app/api/index/[projectId]/summarize/route";
import { GET as whoami } from "@/app/api/token/whoami/route";
import { setLlmForTests } from "@/server/llm";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { type CliDeps, main } from "@brain/cli";
import type { Llm } from "@brain/core";
import { filesRepo, projectTokensRepo, projectsRepo, symbolsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../../..",
  "tests/fixtures/component-app",
);

type Handler = (req: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>;
const routes: [RegExp, Handler][] = [
  [/^\/api\/index\/([^/]+)\/diff$/, diff],
  [/^\/api\/index\/([^/]+)\/summarize$/, summarize],
  [/^\/api\/index\/([^/]+)$/, upload],
];

// The CLI's fetch, routed in-process to the real route handlers (PGlite behind them). Records every request.
function serverFetch() {
  const requests: { path: string; body: string }[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const req = new Request(url, init);
    const path = new URL(req.url).pathname;
    requests.push({ path, body: typeof init?.body === "string" ? init.body : "" });
    if (path === "/api/token/whoami") return whoami(req);
    for (const [re, handler] of routes) {
      const m = path.match(re);
      if (m?.[1]) return handler(req, { params: Promise.resolve({ projectId: m[1] }) });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, requests };
}

function countingLlm() {
  let calls = 0;
  const llm: Llm = {
    async complete() {
      calls++;
      return "Renders part of the page.";
    },
  };
  return { llm, calls: () => calls };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? listFiles(abs) : [abs];
  });
}

describe("FEAT-008 projectbrain index end to end (CLI -> /api/index -> PGlite)", () => {
  let world: TestWorld;
  let projectId: string;
  let token: string;

  beforeEach(async () => {
    world = await createTestWorld();
    const user = await world.createUser();
    projectId = (await projectsRepo.create(world.db, user.id, { name: "demo" })).id;
    token = (await projectTokensRepo.create(world.db, projectId)).token;
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    setLlmForTests(null);
    await world.teardown();
  });

  function cli(repo: string, fetchImpl: CliDeps["fetch"]) {
    const home = mkdtempSync(join(tmpdir(), "pb-home-"));
    const out: string[] = [];
    const err: string[] = [];
    const deps: CliDeps = {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), NO_COLOR: "1" },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => `${token}\n`,
    };
    const run = async (...argv: string[]) => {
      out.length = 0;
      err.length = 0;
      return main(argv, deps);
    };
    return { run, out, err };
  }

  function copyFixture(): string {
    const repo = mkdtempSync(join(tmpdir(), "pb-repo-"));
    cpSync(fixtureRoot, repo, { recursive: true });
    return repo;
  }

  function generateRepo(n: number): string {
    const repo = mkdtempSync(join(tmpdir(), "pb-gen-"));
    mkdirSync(join(repo, "src/components/gen"), { recursive: true });
    for (let i = 0; i < n; i++) {
      writeFileSync(
        join(repo, `src/components/gen/Comp${i}.tsx`),
        `export function Comp${i}({ label }: { label: string }) {\n  return <div className="c${i}">{label}</div>;\n}\n`,
      );
    }
    return repo;
  }

  it("AC-008-02 index parses locally and uploads files, symbols and routes in batches of at most 200 files", async () => {
    setLlmForTests(countingLlm().llm);
    const repo = copyFixture();
    cpSync(generateRepo(450), repo, { recursive: true });
    const server = serverFetch();
    const c = cli(repo, server.fetchImpl);
    expect(await c.run("login", "--api-url", "https://brain.test")).toBe(0);
    expect(await c.run("index")).toBe(0);

    const uploads = server.requests.filter((r) => /^\/api\/index\/[^/]+$/.test(r.path));
    const sizes = uploads.map((r) => (JSON.parse(r.body) as { files: unknown[] }).files.length);
    expect(sizes).toEqual([200, 200, 56]);
    const stored = await filesRepo.list(world.db, projectId);
    expect(stored).toHaveLength(456);
    const symbols = await symbolsRepo.list(world.db, projectId);
    expect(symbols.filter((s) => s.kind === "component").length).toBeGreaterThanOrEqual(455);
    expect(symbols.filter((s) => s.kind === "route").map((s) => [s.name, s.signature])).toEqual([
      ["/", "page"],
    ]);
    expect(c.out).toContain("Uploaded 456 changed, 0 unchanged");
  });

  it("AC-008-03 no upload request body contains source text from the fixture files", async () => {
    setLlmForTests(countingLlm().llm);
    const repo = copyFixture();
    const server = serverFetch();
    const c = cli(repo, server.fetchImpl);
    await c.run("login", "--api-url", "https://brain.test");
    expect(await c.run("index")).toBe(0);
    const bodies = server.requests
      .filter((r) => r.path.startsWith("/api/index/"))
      .map((r) => r.body);
    expect(bodies.length).toBeGreaterThan(1);
    const sourceLines = listFiles(repo)
      .filter((f) => /\.(tsx?|jsx?)$/.test(f))
      .flatMap((f) => readFileSync(f, "utf8").split("\n"))
      .map((l) => l.trim())
      .filter((l) => l.length >= 12);
    expect(sourceLines.length).toBeGreaterThan(10);
    const keys = new Set<string>();
    const collect = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          collect(x);
        }
    };
    const ranges: unknown[] = [];
    for (const body of bodies) {
      for (const line of sourceLines) expect(body).not.toContain(line);
      if (!body) continue;
      const parsed = JSON.parse(body);
      collect(parsed);
      if ("after" in parsed) ranges.push(parsed.after, parsed.through);
    }
    expect([...keys].sort()).toEqual([
      "after",
      "files",
      "hash",
      "kind",
      "name",
      "path",
      "signature",
      "symbols",
      "through",
    ]);
    // The diff range bounds (KI-024) are only repo paths or null.
    const paths = new Set(listFiles(repo).map((f) => f.slice(repo.length + 1)));
    for (const r of ranges) expect(r === null || paths.has(r as string)).toBe(true);
  });

  it("AC-008-06 a re-run uploads only files whose hash changed and prints 'N changed, M unchanged'", async () => {
    setLlmForTests(countingLlm().llm);
    const repo = copyFixture();
    const server = serverFetch();
    const c = cli(repo, server.fetchImpl);
    await c.run("login", "--api-url", "https://brain.test");
    await c.run("index");
    expect(c.out).toContain("Uploaded 6 changed, 0 unchanged");

    server.requests.length = 0;
    expect(await c.run("index")).toBe(0);
    expect(c.out).toContain("Uploaded 0 changed, 6 unchanged");
    expect(server.requests.filter((r) => /^\/api\/index\/[^/]+$/.test(r.path))).toEqual([]);

    const button = join(repo, "src/components/ui/Button.tsx");
    writeFileSync(button, `${readFileSync(button, "utf8")}\n// edited\n`);
    server.requests.length = 0;
    expect(await c.run("index")).toBe(0);
    expect(c.out).toContain("Uploaded 1 changed, 5 unchanged");
    const uploads = server.requests.filter((r) => /^\/api\/index\/[^/]+$/.test(r.path));
    expect(
      uploads.map((r) => JSON.parse(r.body).files.map((f: { path: string }) => f.path)),
    ).toEqual([["src/components/ui/Button.tsx"]]);
  });

  it("KI-022 an unchanged re-index through the CLI makes 0 AI calls, and so does an edit that keeps every signature", async () => {
    const ai = countingLlm();
    setLlmForTests(ai.llm);
    const repo = copyFixture();
    const c = cli(repo, serverFetch().fetchImpl);
    await c.run("login", "--api-url", "https://brain.test");
    expect(await c.run("index")).toBe(0);
    const first = ai.calls();
    const components = (await symbolsRepo.listComponents(world.db, projectId)).length;
    expect(first).toBe(components);
    expect(first).toBeGreaterThan(0);

    expect(await c.run("index")).toBe(0);
    expect(ai.calls()).toBe(first);

    // The file is re-uploaded (new hash) but its components' summary inputs are unchanged.
    const button = join(repo, "src/components/ui/Button.tsx");
    writeFileSync(button, `${readFileSync(button, "utf8")}\n// edited\n`);
    expect(await c.run("index")).toBe(0);
    expect(c.out).toContain("Uploaded 1 changed, 5 unchanged");
    expect(ai.calls()).toBe(first);
    const rows = await symbolsRepo.listComponents(world.db, projectId);
    expect(
      rows.every((r) => r.summary === "Renders part of the page." && r.summaryAttempts === 1),
    ).toBe(true);
  });

  it("AC-008-07 indexing and uploading a 500-file repo takes under 60 s end to end", async () => {
    setLlmForTests(countingLlm().llm);
    const repo = generateRepo(500);
    const c = cli(repo, serverFetch().fetchImpl);
    await c.run("login", "--api-url", "https://brain.test");
    const started = performance.now();
    expect(await c.run("index")).toBe(0);
    const seconds = (performance.now() - started) / 1000;
    console.info(`AC-008-07 500 files end to end: ${seconds.toFixed(1)} s`);
    expect(seconds).toBeLessThan(60);
    expect(await filesRepo.list(world.db, projectId)).toHaveLength(500);
    expect(c.out).toContain("Uploaded 500 changed, 0 unchanged");
  }, 120_000);
  it("KI-024 a file deleted locally is removed from the index with its symbols on the next index", async () => {
    setLlmForTests(countingLlm().llm);
    const repo = copyFixture();
    cpSync(generateRepo(250), repo, { recursive: true });
    const c = cli(repo, serverFetch().fetchImpl);
    await c.run("login", "--api-url", "https://brain.test");
    expect(await c.run("index")).toBe(0);
    expect(await filesRepo.list(world.db, projectId)).toHaveLength(256);

    // One file in the first diff batch, one in the last, one whole fixture file.
    rmSync(join(repo, "src/components/gen/Comp0.tsx"));
    rmSync(join(repo, "src/components/gen/Comp99.tsx"));
    rmSync(join(repo, "src/components/ui/Button.tsx"));
    expect(await c.run("index")).toBe(0);
    expect(c.out).toContain("Uploaded 0 changed, 253 unchanged, 3 deleted");
    const stored = (await filesRepo.list(world.db, projectId)).map((f) => f.path);
    expect(stored).toHaveLength(253);
    for (const gone of [
      "src/components/gen/Comp0.tsx",
      "src/components/gen/Comp99.tsx",
      "src/components/ui/Button.tsx",
    ]) {
      expect(stored).not.toContain(gone);
    }
    const components = await symbolsRepo.listComponents(world.db, projectId);
    expect(components.map((c) => c.name)).not.toContain("Button");
    expect(components.map((c) => c.name)).not.toContain("Comp0");
  });

  it("KI-023 when the project's daily AI budget is used up the CLI says summaries wait for the next day", async () => {
    vi.stubEnv("AI_CALLS_PER_PROJECT_PER_DAY", "2");
    const ai = countingLlm();
    setLlmForTests(ai.llm);
    const repo = copyFixture();
    const c = cli(repo, serverFetch().fetchImpl);
    await c.run("login", "--api-url", "https://brain.test");
    expect(await c.run("index")).toBe(0);
    expect(ai.calls()).toBe(2);
    expect(c.out.join("\n")).toMatch(
      /Daily AI budget for this project is used up: \d+ components wait until \d{4}-\d\d-\d\d \d\d:\d\d UTC\./,
    );
  });
});
