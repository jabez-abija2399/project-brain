import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../db";
import { createTestDb } from "../testing";
import { featureFilesRepo, featuresRepo, filesRepo, projectsRepo, usersRepo } from "./index";

// Drizzle wraps the driver error; Postgres code 23505 = unique_violation.
const UNIQUE_VIOLATION = { cause: { code: "23505" } };

describe("FEAT-006 feature_files roles", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let db: ReturnType<typeof fromPglite>;
  beforeEach(async () => {
    pg = await createTestDb();
    db = fromPglite(pg);
  });
  afterEach(async () => {
    await pg.close();
  });

  it("AC-006-01 the database allows one primary feature per file, any number of shared links", async () => {
    await usersRepo.upsertById(db, { id: "u1", name: "u1", email: "u1@example.com" });
    const project = await projectsRepo.create(db, "u1", { name: "p" });
    const file = await filesRepo.insert(db, project.id, { path: "src/lib/cn.ts", hash: "h" });
    const [a, b, c] = await Promise.all(
      ["a", "b", "c"].map((name) => featuresRepo.insert(db, project.id, { name })),
    );
    if (!a || !b || !c) throw new Error("features not created");

    await featureFilesRepo.link(db, project.id, { featureId: a.id, fileId: file.id });
    await expect(
      featureFilesRepo.link(db, project.id, { featureId: b.id, fileId: file.id }),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
    await featureFilesRepo.link(db, project.id, {
      featureId: b.id,
      fileId: file.id,
      role: "shared",
    });
    await featureFilesRepo.link(db, project.id, {
      featureId: c.id,
      fileId: file.id,
      role: "shared",
    });
    const roles = (await featureFilesRepo.listForFile(db, project.id, file.id)).map((l) => l.role);
    expect(roles.sort()).toEqual(["primary", "shared", "shared"]);
  });
});
