import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../pglite";
import { createTestDb } from "../testing";
import { filesRepo, projectsRepo, usersRepo } from "./index";

describe("FEAT-011 filesRepo.byIds", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let db: ReturnType<typeof fromPglite>;
  beforeEach(async () => {
    pg = await createTestDb();
    db = fromPglite(pg);
  });
  afterEach(async () => {
    await pg.close();
  });

  it("AC-011-03 returns only the project's own files, even when given another project's file ids", async () => {
    await usersRepo.upsertById(db, { id: "u1", name: "u1", email: "u1@example.com" });
    const mine = await projectsRepo.create(db, "u1", { name: "mine" });
    const other = await projectsRepo.create(db, "u1", { name: "other" });
    const a = await filesRepo.insert(db, mine.id, { path: "src/A.tsx", hash: "a" });
    const b = await filesRepo.insert(db, other.id, { path: "src/B.tsx", hash: "b" });

    const rows = await filesRepo.byIds(db, mine.id, [a.id, b.id]);
    expect(rows.map((r) => r.path)).toEqual(["src/A.tsx"]);
    expect(await filesRepo.byIds(db, mine.id, [])).toEqual([]);
  });
});
