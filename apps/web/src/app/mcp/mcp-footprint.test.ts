// Roadmap Phase 2a: Codeceipt's footprint in an agent session. Budgets from docs/performance.md (baseline 2026-11-06:
// tools/list 10,247 characters, ≈ 2,560 tokens). Tokens are estimated as characters / 4.
import { warmContextPacks } from "@/server/context-pack";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { buildHandoffNote } from "@brain/core";
import {
  CONTEXT_PACK_CACHE_TTL_MS,
  contextPackCacheRepo,
  featureFilesRepo,
  featuresRepo,
  filesRepo,
  projectTokensRepo,
  projectsRepo,
  symbolsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool, rpc } from "./mcp-test-client";

const TOOLS_BASELINE_CHARS = 10_247;
const TOOLS_BUDGET_CHARS = 6_500;

let world: TestWorld;
let projectId: string;
let token: string;

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  token = (await projectTokensRepo.create(world.db, projectId)).token;
});

afterEach(async () => {
  await world.teardown();
});

async function tools() {
  const list = await rpc("tools/list", {}, token);
  return list.result?.tools as { name: string; description: string; inputSchema: unknown }[];
}

async function seedFeature(name: string, files: string[], status?: "in_progress") {
  const feature = await featuresRepo.insert(world.db, projectId, {
    name,
    ...(status ? { status } : {}),
  });
  for (const path of files) {
    const file = await filesRepo.insert(world.db, projectId, { path, hash: "h" });
    await featureFilesRepo.link(world.db, projectId, { featureId: feature.id, fileId: file.id });
    await symbolsRepo.insert(world.db, projectId, {
      fileId: file.id,
      kind: "component",
      name: `${path.split("/").pop()?.replace(/\..*$/, "")}Panel`,
      summary: "Shows the panel",
    });
  }
  return feature;
}

describe("Phase 2a: tool definitions within budget", () => {
  it("PERF-2A-01 tools/list is smaller than the baseline and within the budget", async () => {
    const chars = JSON.stringify(await tools()).length;
    console.info(`[footprint] tools/list ${chars} chars (≈ ${Math.round(chars / 4)} tokens)`);
    expect(chars).toBeLessThan(TOOLS_BASELINE_CHARS);
    expect(chars).toBeLessThanOrEqual(TOOLS_BUDGET_CHARS);
  });

  it("PERF-2A-02 every tool description is short (at most 300 characters)", async () => {
    for (const t of await tools()) expect(t.description.length, t.name).toBeLessThanOrEqual(300);
  });

  it("PERF-2A-03 generate_receipt advertises only the fields an agent fills in", async () => {
    const receipt = (await tools()).find((t) => t.name === "generate_receipt");
    const props = Object.keys(
      (receipt?.inputSchema as { properties: Record<string, unknown> }).properties,
    ).sort();
    expect(props).toEqual(
      ["changedFiles", "commitSha", "packageJson", "projectId", "requestId"].sort(),
    );
  });

  it("PERF-2A-04 the hooks' fields still reach the receipt (accepted, not advertised)", async () => {
    const res = await callTool(
      "generate_receipt",
      {
        changedFiles: ["src/a.test.ts"],
        testIntegrity: {
          flags: [{ kind: "skipped_tests", file: "src/a.test.ts", names: ["adds"], count: 1 }],
        },
      },
      token,
    );
    expect(res.isError, res.text).toBe(false);
    expect(res.text).toContain("skipped_tests");
  });

  it("PERF-2A-05 attack: a hook field with the wrong shape is still refused by the service", async () => {
    const res = await callTool(
      "generate_receipt",
      { changedFiles: ["a.ts"], testIntegrity: { flags: "not a list" } },
      token,
    );
    expect(res.isError).toBe(true);
  });
});

describe("Phase 2a: one feature-list tool", () => {
  it("PERF-2A-06 where_did_we_stop {features: true} answers the feature list; the old tool is one short line", async () => {
    await seedFeature("Checkout", ["src/checkout/Cart.tsx"]);
    const old = (await tools()).find((t) => t.name === "list_features");
    expect(JSON.stringify(old).length).toBeLessThanOrEqual(400);
    const res = await callTool("where_did_we_stop", { features: true }, token);
    const body = JSON.parse(res.text) as {
      features: { name: string; files: number }[];
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.features[0]).toMatchObject({ name: "Checkout", files: 1 });
  });

  it("PERF-2A-07 the old name still works for one release, with the same answer", async () => {
    await seedFeature("Checkout", ["src/checkout/Cart.tsx"]);
    const old = await callTool("list_features", {}, token);
    const now = await callTool("where_did_we_stop", { features: true }, token);
    expect(old.isError, old.text).toBe(false);
    expect(JSON.parse(old.text)).toEqual(JSON.parse(now.text));
  });

  it("PERF-2A-08 attack: neither name reaches another project", async () => {
    const other = await world.createUser({ name: "other" });
    const otherProject = (await projectsRepo.create(world.db, other.id, { name: "vault" })).id;
    for (const [name, args] of [
      ["list_features", { projectId: otherProject }],
      ["where_did_we_stop", { projectId: otherProject, features: true }],
    ] as const) {
      const res = await callTool(name, args, token);
      expect(res.isError, name).toBe(true);
    }
  });
});

describe("Phase 2a: start note within budget", () => {
  it("PERF-2A-09 a worst-case note stays within ≈ 500 tokens and points to the full feature list", () => {
    const many = Array.from({ length: 100 }, (_, i) => `Feature number ${i} (id f${i})`);
    const note = buildHandoffNote({
      session: {
        goal: "g".repeat(400),
        done: "d".repeat(400),
        unfinished: "u".repeat(400),
        nextStep: "n",
      },
      checklist: Array.from({ length: 40 }, (_, i) => `item ${i}`),
      questions: [],
      untested: [],
      featuresInProgress: many.slice(0, 10),
      decisions: [],
      directives: [],
      features: many,
      nextFeature: null,
    });
    expect(note.length / 4).toBeLessThanOrEqual(500);
    expect(note).toContain("where_did_we_stop features: true");
  });
});

describe("Phase 2a: context packs cached at index time", () => {
  it("PERF-2A-10 index time builds a pack's files and components ahead, and reads use them", async () => {
    const feature = await seedFeature("Checkout", ["src/checkout/Cart.tsx"]);
    await warmContextPacks(world.db, projectId);
    const cached = await contextPackCacheRepo.get(world.db, projectId, feature.id);
    expect(cached?.files).toEqual(["src/checkout/Cart.tsx"]);
    // A reused entry is what the next read shows (proves the read uses the cache).
    await contextPackCacheRepo.put(world.db, projectId, feature.id, {
      ...cached!,
      files: ["src/checkout/FromCache.tsx"],
    });
    const second = await callTool("get_context_pack", { feature: "Checkout" }, token);
    expect(second.text).toContain("src/checkout/FromCache.tsx");
  });

  it("PERF-2A-11 any change to the project's files, symbols or features clears its cached packs", async () => {
    const feature = await seedFeature("Checkout", ["src/checkout/Cart.tsx"]);
    await warmContextPacks(world.db, projectId);
    expect(await contextPackCacheRepo.get(world.db, projectId, feature.id)).not.toBeNull();
    const file = await filesRepo.insert(world.db, projectId, {
      path: "src/checkout/Pay.tsx",
      hash: "h",
    });
    expect(await contextPackCacheRepo.get(world.db, projectId, feature.id)).toBeNull();
    await featureFilesRepo.link(world.db, projectId, { featureId: feature.id, fileId: file.id });
    const fresh = await callTool("get_context_pack", { feature: "Checkout" }, token);
    expect(fresh.text).toContain("src/checkout/Pay.tsx");
  });

  it("PERF-2A-12 attack: one project's change never clears or reveals another project's cache", async () => {
    const feature = await seedFeature("Checkout", ["src/checkout/Cart.tsx"]);
    await warmContextPacks(world.db, projectId);
    const other = await world.createUser({ name: "other" });
    const otherProject = (await projectsRepo.create(world.db, other.id, { name: "vault" })).id;
    await filesRepo.insert(world.db, otherProject, { path: "src/x.ts", hash: "h" });
    expect(await contextPackCacheRepo.get(world.db, projectId, feature.id)).not.toBeNull();
    expect(await contextPackCacheRepo.get(world.db, otherProject, feature.id)).toBeNull();
  });

  it("PERF-2A-18 an entry older than the time limit is not used (bounds a read that raced an index change)", async () => {
    const feature = await seedFeature("Checkout", ["src/checkout/Cart.tsx"]);
    await warmContextPacks(world.db, projectId);
    const later = new Date(Date.now() + CONTEXT_PACK_CACHE_TTL_MS + 1000);
    expect(await contextPackCacheRepo.get(world.db, projectId, feature.id, later)).toBeNull();
  });

  it("PERF-2A-19 index time: packs of features in progress are built ahead", async () => {
    const feature = await seedFeature("Checkout", ["src/checkout/Cart.tsx"], "in_progress");
    expect(await warmContextPacks(world.db, projectId)).toBe(1);
    expect((await contextPackCacheRepo.get(world.db, projectId, feature.id))?.files).toEqual([
      "src/checkout/Cart.tsx",
    ]);
  });

  it("PERF-2A-21 a read never writes: a cache miss builds the pack live and stores nothing", async () => {
    const feature = await seedFeature("Checkout", ["src/checkout/Cart.tsx"]);
    const res = await callTool("get_context_pack", { feature: "Checkout" }, token);
    expect(res.text).toContain("src/checkout/Cart.tsx");
    expect(await contextPackCacheRepo.get(world.db, projectId, feature.id)).toBeNull();
  });

  it("PERF-2A-13 reads stay fast: get_context_pack p95 under 150 ms in-process", async () => {
    await seedFeature(
      "Checkout",
      Array.from({ length: 25 }, (_, i) => `src/checkout/F${i}.tsx`),
    );
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      await callTool("get_context_pack", { feature: "Checkout" }, token);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95) - 1]).toBeLessThan(150);
  });
});
