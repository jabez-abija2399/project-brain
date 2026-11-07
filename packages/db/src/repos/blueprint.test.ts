import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../pglite";
import { createTestDb } from "../testing";
import {
  BlueprintConflictError,
  blueprintRepo,
  boundariesRepo,
  criteriaRepo,
  featuresRepo,
  projectsRepo,
  usersRepo,
} from "./index";

// Roadmap Phase 3a: Blueprint repositories (versions, criteria, boundaries).
describe("blueprint repositories", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let db: ReturnType<typeof fromPglite>;
  let projectId: string;
  let featureId: string;
  const snap = (live: { criteria: unknown[] }, v: number) => ({
    snapshot: { v, criteria: live.criteria.length },
    hash: `h${v}`,
  });
  beforeEach(async () => {
    pg = await createTestDb();
    db = fromPglite(pg);
    await usersRepo.upsertById(db, { id: "u1", name: "u1", email: "u1@example.com" });
    projectId = (await projectsRepo.create(db, "u1", { name: "p" })).id;
    featureId = (await featuresRepo.insert(db, projectId, { name: "Checkout" })).id;
  });
  afterEach(async () => {
    await pg.close();
  });

  it("BP-3A-15 each owner change writes the next version; a stale base version is refused", async () => {
    const v1 = await blueprintRepo.commit(db, projectId, {
      userId: "u1",
      baseVersion: 0,
      reason: "edit",
      apply: async (tx) => {
        await criteriaRepo.insert(tx, projectId, {
          featureId,
          text: "THE SYSTEM SHALL NOT store card numbers",
          kind: "must_never",
          createdBy: "owner",
          status: "active",
        });
      },
      snapshot: snap,
    });
    expect(v1).toBe(1);
    expect(await blueprintRepo.currentVersion(db, projectId)).toBe(1);
    expect((await blueprintRepo.getVersion(db, projectId, 1))?.snapshot).toEqual({
      v: 1,
      criteria: 1,
    });
    await expect(
      blueprintRepo.commit(db, projectId, {
        userId: "u1",
        baseVersion: 0,
        reason: "edit",
        apply: async () => {},
        snapshot: snap,
      }),
    ).rejects.toBeInstanceOf(BlueprintConflictError);
    expect(await blueprintRepo.currentVersion(db, projectId)).toBe(1);
  });

  it("BP-3A-33 a failed change leaves no version and no rows behind", async () => {
    await expect(
      blueprintRepo.commit(db, projectId, {
        userId: "u1",
        baseVersion: 0,
        reason: "edit",
        apply: async (tx) => {
          await boundariesRepo.insert(tx, projectId, {
            kind: "protected_path",
            pattern: "supabase/migrations/**",
            note: null,
            createdBy: "owner",
            status: "active",
          });
          throw new Error("boom");
        },
        snapshot: snap,
      }),
    ).rejects.toThrow("boom");
    expect(await blueprintRepo.currentVersion(db, projectId)).toBe(0);
    expect((await blueprintRepo.live(db, projectId)).boundaries).toEqual([]);
  });

  it("BP-3A-34 live state lists dependencies, areas, criteria (not retired) and boundaries", async () => {
    const other = (await featuresRepo.insert(db, projectId, { name: "Cart" })).id;
    await blueprintRepo.setDependencies(db, projectId, featureId, [other]);
    await blueprintRepo.setAreas(db, projectId, featureId, ["src/checkout/**"]);
    const c = await criteriaRepo.insert(db, projectId, {
      featureId,
      text: "x",
      kind: "behaviour",
      createdBy: "agent",
      status: "proposal",
    });
    await criteriaRepo.insert(db, projectId, {
      featureId,
      text: "old",
      kind: "behaviour",
      createdBy: "owner",
      status: "retired",
    });
    const live = await blueprintRepo.live(db, projectId);
    expect(live.dependencies).toEqual([{ featureId, dependsOnId: other }]);
    expect(live.areas).toEqual([{ featureId, pattern: "src/checkout/**" }]);
    expect(live.criteria.map((r) => r.id)).toEqual([c.id]);
    expect(await criteriaRepo.countOpenProposals(db, projectId)).toBe(1);
  });
});
