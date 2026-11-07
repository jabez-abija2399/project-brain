// Roadmap Phase 3a: the Project Blueprint service (owner side) and its agent side (MCP proposals and summary).
import {
  blueprintRepo,
  criteriaRepo,
  featuresRepo,
  filesRepo,
  projectTokensRepo,
  projectsRepo,
} from "@brain/db";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool } from "../app/mcp/mcp-test-client";
import type { SessionUser } from "./auth";
import {
  blueprintView,
  decideProposal,
  editBlueprint,
  restoreVersion,
  versionHistory,
} from "./blueprint";
import { blueprintSummary, proposeBlueprint } from "./blueprint-agent";
import { getContextPack } from "./context-pack";
import { resetMigrationCheckForTests } from "./migration-check";
import { type TestWorld, createTestWorld } from "./test-helpers";

let world: TestWorld;
let owner: SessionUser;
let pid: string;
let checkout: string;
let cart: string;
let token: string;

beforeEach(async () => {
  resetMigrationCheckForTests();
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  pid = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  checkout = (await featuresRepo.insert(world.db, pid, { name: "Checkout" })).id;
  cart = (await featuresRepo.insert(world.db, pid, { name: "Cart" })).id;
  token = (await projectTokensRepo.create(world.db, pid)).token;
});
afterEach(async () => {
  resetMigrationCheckForTests();
  await world.teardown();
});

const NEVER = "THE SYSTEM SHALL NOT store card numbers";

describe("Phase 3a: Blueprint (owner)", () => {
  it("BP-3A-35 owner edits become version 1: criteria with EARS forms, dependencies, areas, a boundary", async () => {
    const r = await editBlueprint(world.db, owner, pid, {
      baseVersion: 0,
      ops: [
        { op: "setPurpose", featureId: checkout, purpose: "Take payment for the cart" },
        { op: "setDependencies", featureId: checkout, dependsOn: [cart] },
        { op: "setAreas", featureId: checkout, patterns: ["src/checkout/**"] },
        { op: "addCriterion", featureId: checkout, text: NEVER, kind: "must_never" },
        {
          op: "addCriterion",
          featureId: checkout,
          text: "The checkout should be fast",
          kind: "behaviour",
        },
        {
          op: "addBoundary",
          kind: "protected_path",
          pattern: "supabase/migrations/**",
          note: null,
        },
      ],
    });
    expect(r.version).toBe(1);
    const view = await blueprintView(world.db, owner, pid);
    expect(view.version).toBe(1);
    const never = view.criteria.find((c) => c.text === NEVER);
    expect(never?.ears).toMatchObject({ form: "never", negated: true });
    expect(view.proof[never?.id ?? ""]).toBe("not_proven");
    // Unclear wording is flagged with a rewrite; the must-never criterion covers Checkout, Cart has none.
    const checks = view.checks.find((c) => c.featureId === checkout);
    expect(checks?.criteria.some((c) => c.flags.length > 0)).toBe(true);
    expect(view.checks.find((c) => c.featureId === cart)?.coverage).not.toBeNull();
    expect(checks?.coverage).toBeNull();
    const v1 = await blueprintRepo.getVersion(world.db, pid, 1);
    expect(JSON.stringify(v1?.snapshot)).toContain("src/checkout/**");
  });

  it("BP-3A-15 a stale base version is refused with 409 and changes nothing", async () => {
    await editBlueprint(world.db, owner, pid, {
      baseVersion: 0,
      ops: [{ op: "addCriterion", featureId: checkout, text: NEVER, kind: "must_never" }],
    });
    await expect(
      editBlueprint(world.db, owner, pid, {
        baseVersion: 0,
        ops: [
          {
            op: "addCriterion",
            featureId: cart,
            text: "THE SYSTEM SHALL show items",
            kind: "behaviour",
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 409, code: "blueprint_changed" });
    expect((await blueprintView(world.db, owner, pid)).criteria).toHaveLength(1);
  });

  it("BP-3A-21 a circle of dependencies is refused", async () => {
    await expect(
      editBlueprint(world.db, owner, pid, {
        baseVersion: 0,
        ops: [
          { op: "setDependencies", featureId: checkout, dependsOn: [cart] },
          { op: "setDependencies", featureId: cart, dependsOn: [checkout] },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await blueprintRepo.currentVersion(world.db, pid)).toBe(0);
  });

  it("BP-3A-16 restore brings back an old version as a new one: later criteria are retired, never deleted", async () => {
    await editBlueprint(world.db, owner, pid, {
      baseVersion: 0,
      ops: [{ op: "addCriterion", featureId: checkout, text: NEVER, kind: "must_never" }],
    });
    await editBlueprint(world.db, owner, pid, {
      baseVersion: 1,
      ops: [
        {
          op: "addCriterion",
          featureId: checkout,
          text: "WHEN a user pays, THE SYSTEM SHALL send a receipt",
          kind: "behaviour",
        },
      ],
    });
    await world.db.execute(sql`UPDATE features SET status = 'in_progress' WHERE id = ${checkout}`);
    const r = await restoreVersion(world.db, owner, pid, { version: 1, baseVersion: 2 });
    expect(r.version).toBe(3);
    const view = await blueprintView(world.db, owner, pid);
    expect(view.criteria.map((c) => c.text)).toEqual([NEVER]);
    const all = await criteriaRepo.all(world.db, pid);
    expect(all.find((c) => c.text.startsWith("WHEN"))?.status).toBe("retired");
    expect(view.features.find((f) => f.id === checkout)?.status).toBe("in_progress");
    const history = await versionHistory(world.db, owner, pid);
    expect(history.versions[0]).toMatchObject({ version: 3, reason: "restore", restoredFrom: 1 });
    expect(history.versions).toHaveLength(3);
  });

  it("BP-3A-19 before migration 0054 is applied: Blueprint calls say 'not set up yet', context packs work as before", async () => {
    await world.db.execute(sql`DELETE FROM "_brain_migrations" WHERE id = '0054_blueprint'`);
    resetMigrationCheckForTests();
    await expect(blueprintView(world.db, owner, pid)).rejects.toMatchObject({
      code: "blueprint_not_ready",
    });
    const res = await callTool(
      "propose_blueprint",
      { feature: "Checkout", text: NEVER, kind: "must_never" },
      token,
    );
    expect(res.isError).toBe(true);
    expect(res.text).toContain("blueprint_not_ready");
    const pack = await getContextPack(world.db, pid, "Checkout");
    expect(pack).not.toContain("CRITERIA");
  });
});

describe("Phase 3a: Blueprint (agents propose, the owner decides)", () => {
  it("BP-3A-36 an agent's proposal returns its EARS form and flags, and only the owner's acceptance makes it active", async () => {
    const res = await callTool(
      "propose_blueprint",
      { feature: "Checkout", text: "the system should be fast", kind: "behaviour" },
      token,
    );
    const body = JSON.parse(res.text) as { id: string; status: string; flags: { code: string }[] };
    expect(body.status).toBe("proposal");
    expect(body.flags.map((f) => f.code)).toContain("weak_modal");
    expect(await blueprintRepo.currentVersion(world.db, pid)).toBe(0);
    expect((await getContextPack(world.db, pid, "Checkout")).includes("should be fast")).toBe(
      false,
    );
    await decideProposal(world.db, owner, pid, {
      kind: "criterion",
      id: body.id,
      accept: true,
      baseVersion: 0,
    });
    expect(await getContextPack(world.db, pid, "Checkout")).toContain("should be fast");
    expect(await blueprintRepo.currentVersion(world.db, pid)).toBe(1);
  });

  it("BP-3A-37 the Blueprint summary lists features with criteria counts and must-never gaps", async () => {
    await editBlueprint(world.db, owner, pid, {
      baseVersion: 0,
      ops: [
        { op: "addCriterion", featureId: checkout, text: NEVER, kind: "must_never" },
        { op: "setDependencies", featureId: checkout, dependsOn: [cart] },
      ],
    });
    const res = await callTool("where_did_we_stop", { blueprint: true }, token);
    expect(res.text).toContain("BLUEPRINT v1");
    expect(res.text).toMatch(/Cart .*no must-never yet/);
    expect(res.text).toMatch(/Checkout .*criteria 1.*after Cart/);
    expect(await blueprintSummary(world.db, { id: "t", projectId: pid })).toContain("BLUEPRINT v1");
  });

  it("BP-3A-38 linking a test needs a file of the same project", async () => {
    await editBlueprint(world.db, owner, pid, {
      baseVersion: 0,
      ops: [{ op: "addCriterion", featureId: checkout, text: NEVER, kind: "must_never" }],
    });
    const c = (await criteriaRepo.all(world.db, pid))[0];
    const file = await filesRepo.insert(world.db, pid, {
      path: "src/checkout/pay.test.ts",
      hash: "h",
    });
    await editBlueprint(world.db, owner, pid, {
      baseVersion: 1,
      ops: [
        {
          op: "linkTest",
          criterionId: c?.id ?? "",
          fileId: file.id,
          testName: "never stores card numbers",
        },
      ],
    });
    const view = await blueprintView(world.db, owner, pid);
    expect(view.tests).toEqual([
      expect.objectContaining({
        path: "src/checkout/pay.test.ts",
        testName: "never stores card numbers",
      }),
    ]);
    // Linked but never run: honest evidence says not proven yet.
    expect(view.proof[c?.id ?? ""]).toBe("not_proven");
  });

  it("BP-3A-39 proposeBlueprint (service) refuses a feature it cannot find", async () => {
    await expect(
      proposeBlueprint(
        world.db,
        { id: "t", projectId: pid },
        { feature: "Nope", text: NEVER, kind: "must_never" },
      ),
    ).rejects.toBeTruthy();
  });
});
