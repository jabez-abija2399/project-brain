import { dbTablesRepo, filesRepo, githubRepo, projectsRepo, symbolsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeRepo, makeGithubConfig, mockGithub, restoreGithub } from "./github-test-helpers";
import type { PushEventData } from "./inngest";
import { installationClient } from "./inngest-functions";
import { type StepRunner, runPushIndex } from "./push-index";
import { type TestWorld, createTestWorld } from "./test-helpers";

const BEFORE = "a".repeat(40);
const AFTER = "b".repeat(40);
// Lives only inside fetched file bodies: it must never reach the database, a step result or a log line.
const SENTINEL = ["SOURCE", "BODY", "SENTINEL", "7f3a"].join("_");

let world: TestWorld;
let projectId: string;
let outputs: unknown[];
const step: StepRunner = {
  run: async (_name, fn) => {
    const result = await fn();
    outputs.push(JSON.parse(JSON.stringify(result ?? null)));
    return result;
  },
};

const component = (name: string) =>
  `export function ${name}() {\n  const hidden = "${SENTINEL}";\n  return <div>{hidden}</div>;\n}\n`;

const event = (over: Partial<PushEventData> = {}): PushEventData => ({
  projectId,
  installationId: 77,
  repo: "acme/app",
  before: BEFORE,
  after: AFTER,
  deliveryId: "d-1",
  ...over,
});

function repoWith(changes: FakeRepo["compare"][string], files: FakeRepo["files"]): FakeRepo {
  return {
    installations: { 77: ["acme/app"] },
    userInstallations: [77],
    compare: { [`${BEFORE}...${AFTER}`]: changes },
    files,
  };
}

const run = (data = event()) => runPushIndex(world.db, data, step, () => installationClient(77));

beforeEach(async () => {
  world = await createTestWorld();
  makeGithubConfig();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "app" })).id;
  await githubRepo.linkProject(world.db, projectId, owner.id, 77, "acme/app");
  outputs = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  restoreGithub();
  await world.teardown();
});

describe("index-push job (FEAT-009)", () => {
  it("AC-009-02 re-indexes only the changed files: fetches them, keeps unchanged files, deletes removed and renamed-from paths", async () => {
    const h = (c: string) => c.repeat(64);
    await filesRepo.insert(world.db, projectId, { path: "src/keep.ts", hash: h("1") });
    await filesRepo.insert(world.db, projectId, { path: "src/old.ts", hash: h("2") });
    await filesRepo.insert(world.db, projectId, { path: "src/renamed-from.ts", hash: h("3") });
    const gh = mockGithub(
      repoWith(
        [
          { filename: "src/components/Button.tsx", status: "modified" },
          { filename: "src/pages/Home.tsx", status: "added" },
          { filename: "src/old.ts", status: "removed" },
          {
            filename: "src/new-name.ts",
            status: "renamed",
            previous_filename: "src/renamed-from.ts",
          },
          { filename: "README.md", status: "modified" },
        ],
        {
          "src/components/Button.tsx": component("Button"),
          "src/pages/Home.tsx": `import { Button } from "../components/Button";\n${component("Home")}`,
          "src/new-name.ts": "export const renamed = 1;\n",
          "README.md": "# readme\n",
        },
      ),
    );

    const result = await run();
    expect(result).toMatchObject({ indexed: 3, deleted: 2 });
    expect(gh.fetchedPaths.filter((p) => p !== "tsconfig.json").sort()).toEqual([
      "src/components/Button.tsx",
      "src/new-name.ts",
      "src/pages/Home.tsx",
    ]);
    const stored = await filesRepo.list(world.db, projectId);
    expect(stored.map((f) => f.path).sort()).toEqual([
      "src/components/Button.tsx",
      "src/keep.ts",
      "src/new-name.ts",
      "src/pages/Home.tsx",
    ]);
    expect(stored.find((f) => f.path === "src/keep.ts")?.hash).toBe(h("1"));
    const components = await symbolsRepo.listComponents(world.db, projectId);
    expect(components.map((c) => c.name).sort()).toEqual(["Button", "Home"]);
  });

  it("AC-009-05 no source code is stored, returned from a step or logged: only metadata", async () => {
    const info = vi.spyOn(console, "info");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    mockGithub(
      repoWith([{ filename: "src/Secret.tsx", status: "added" }], {
        "src/Secret.tsx": component("Secret"),
      }),
    );
    await run();

    const tables = await world.pg.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    for (const { table_name } of tables.rows) {
      const rows = await world.pg.query<{ row: string }>(
        `SELECT row_to_json(t)::text AS row FROM "${table_name}" t`,
      );
      for (const r of rows.rows) expect(r.row, table_name).not.toContain(SENTINEL);
    }
    expect(JSON.stringify(outputs)).not.toContain(SENTINEL);
    const logged = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]
      .map((c) => c.map(String).join(" "))
      .join("\n");
    expect(logged).not.toContain(SENTINEL);
    expect((await symbolsRepo.listComponents(world.db, projectId)).map((c) => c.name)).toEqual([
      "Secret",
    ]);
  });

  it("AC-009-06 a push that changes 10 files is re-indexed in under 10 s and the duration is logged", async () => {
    const info = vi.spyOn(console, "info");
    const changes = Array.from({ length: 10 }, (_, i) => ({
      filename: `src/parts/Part${i}.tsx`,
      status: "modified",
    }));
    const files = Object.fromEntries(changes.map((c, i) => [c.filename, component(`Part${i}`)]));
    mockGithub(repoWith(changes, files));

    const started = performance.now();
    const result = await run();
    const ms = performance.now() - started;
    console.log("[perf]", "index-push 10 files", `${ms.toFixed(0)}ms`);
    expect(result).toMatchObject({ indexed: 10 });
    expect(ms).toBeLessThan(10_000);
    const line = info.mock.calls.find((c) => c[0] === "[job]" && c[1] === "index-push");
    expect(line).toBeDefined();
    expect(JSON.parse(String(line?.[2]))).toMatchObject({ projectId, indexed: 10 });
    expect(typeof JSON.parse(String(line?.[2])).ms).toBe("number");
  });

  it("AC-009-05 fail closed (KI-014): a changed Supabase migration marks every table RLS unknown, never enabled", async () => {
    const sqlFile = await filesRepo.insert(world.db, projectId, {
      path: "supabase/migrations/0001_init.sql",
      hash: "d".repeat(64),
    });
    await dbTablesRepo.insert(world.db, projectId, {
      fileId: sqlFile.id,
      schema: "public",
      name: "orders",
      rlsEnabled: true,
    });
    mockGithub(
      repoWith([{ filename: "supabase/migrations/0002_policies.sql", status: "added" }], {
        "supabase/migrations/0002_policies.sql": "alter table orders disable row level security;",
      }),
    );
    const result = await run();
    expect(result).toMatchObject({ rlsUnknown: 1 });
    const [table] = await dbTablesRepo.list(world.db, projectId);
    expect(table).toMatchObject({ rlsEnabled: false, rlsUnknown: true });
  });

  it("AC-009-02 a project no longer linked, or a push that created the branch, is skipped without fetching files", async () => {
    const gh = mockGithub(
      repoWith([{ filename: "src/A.tsx", status: "added" }], { "src/A.tsx": component("A") }),
    );
    expect(await run(event({ repo: "acme/other" }))).toEqual({ skipped: "not_linked" });
    expect(await run(event({ before: "0".repeat(40) }))).toEqual({ skipped: "new_branch" });
    expect(gh.fetchedPaths).toEqual([]);
    expect(await filesRepo.list(world.db, projectId)).toEqual([]);
  });
});
