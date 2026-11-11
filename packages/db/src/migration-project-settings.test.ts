import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATION_IDS, OPTIONAL_MIGRATIONS } from "./migration-check";
import { fromPglite } from "./pglite";
import { projectSettingsRepo, receiptsRepo } from "./repos";
import { createTestDb } from "./testing";

// Roadmap Phase 10b, migration 0056: per-project settings (receipts on pull requests, off by default).
let pg: PGlite;
beforeEach(async () => {
  pg = await createTestDb();
  await pg.exec(`INSERT INTO "user" ("id","name","email") VALUES ('u1','n','u1@example.com')`);
  await pg.exec(
    `INSERT INTO "projects" ("id","owner_id","name") VALUES ('p1','u1','A'),('p2','u1','B')`,
  );
});
afterEach(async () => {
  await pg.close();
});

describe("migration 0056 (project settings)", () => {
  it("PH10B-01 is registered after 0055 and optional", () => {
    expect(MIGRATION_IDS.indexOf("0056_project_settings")).toBe(
      MIGRATION_IDS.indexOf("0055_approvals") + 1,
    );
    expect(OPTIONAL_MIGRATIONS.has("0056_project_settings")).toBe(true);
  });

  it("PH10B-02 PR receipts are off by default, set per project, and never leak to another project", async () => {
    const db = fromPglite(pg);
    expect(await projectSettingsRepo.prReceipts(db, "p1")).toBe(false);
    await projectSettingsRepo.setPrReceipts(db, "p1", true, "u1");
    expect(await projectSettingsRepo.prReceipts(db, "p1")).toBe(true);
    expect(await projectSettingsRepo.prReceipts(db, "p2")).toBe(false);
    await projectSettingsRepo.setPrReceipts(db, "p1", false, "u1");
    expect(await projectSettingsRepo.prReceipts(db, "p1")).toBe(false);
  });

  it("PH10B-03 receipts are found by commit only inside their own project", async () => {
    const db = fromPglite(pg);
    const sha = "a".repeat(40);
    await receiptsRepo.insert(db, "p1", { requestId: null, commitSha: sha, summaryJson: {} });
    await receiptsRepo.insert(db, "p2", { requestId: null, commitSha: sha, summaryJson: {} });
    const found = await receiptsRepo.listByCommits(db, "p1", [sha, "b".repeat(40)]);
    expect(found.map((r) => r.projectId)).toEqual(["p1"]);
    expect(await receiptsRepo.listByCommits(db, "p1", [])).toEqual([]);
  });
});
