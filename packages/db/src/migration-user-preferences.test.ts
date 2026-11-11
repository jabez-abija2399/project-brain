import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATION_IDS, OPTIONAL_MIGRATIONS } from "./migration-check";
import { fromPglite } from "./pglite";
import { userPreferencesRepo } from "./repos";
import { createTestDb } from "./testing";

// Backlog: migration 0057, the "How do you build?" answer per account.
let pg: PGlite;
beforeEach(async () => {
  pg = await createTestDb();
  await pg.exec(
    `INSERT INTO "user" ("id","name","email") VALUES ('u1','n','u1@example.com'),('u2','m','u2@example.com')`,
  );
});
afterEach(async () => {
  await pg.close();
});

describe("migration 0057 (user preferences)", () => {
  it("BL-37 is registered after 0056 and optional; the answer is per account", async () => {
    expect(MIGRATION_IDS.indexOf("0057_user_preferences")).toBe(
      MIGRATION_IDS.indexOf("0056_project_settings") + 1,
    );
    expect(OPTIONAL_MIGRATIONS.has("0057_user_preferences")).toBe(true);
    const db = fromPglite(pg);
    expect(await userPreferencesRepo.buildStyle(db, "u1")).toBeNull();
    await userPreferencesRepo.setBuildStyle(db, "u1", "cursor");
    await userPreferencesRepo.setBuildStyle(db, "u1", "claude");
    expect(await userPreferencesRepo.buildStyle(db, "u1")).toBe("claude");
    expect(await userPreferencesRepo.buildStyle(db, "u2")).toBeNull();
  });
});
