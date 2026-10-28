import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../db";
import { createTestDb } from "../testing";
import { filesRepo, projectsRepo, symbolsRepo, usersRepo } from "./index";

describe("FEAT-007 symbolsRepo components", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let db: ReturnType<typeof fromPglite>;
  beforeEach(async () => {
    pg = await createTestDb();
    db = fromPglite(pg);
  });
  afterEach(async () => {
    await pg.close();
  });

  it("AC-007-04 stores the summary hash and lists only this project's components with their path", async () => {
    await usersRepo.upsertById(db, { id: "u1", name: "u1", email: "u1@example.com" });
    const mine = await projectsRepo.create(db, "u1", { name: "mine" });
    const other = await projectsRepo.create(db, "u1", { name: "other" });
    const file = await filesRepo.insert(db, mine.id, { path: "src/StarRating.tsx", hash: "f1" });
    const otherFile = await filesRepo.insert(db, other.id, { path: "src/Other.tsx", hash: "f2" });

    await symbolsRepo.insertMany(db, mine.id, [
      {
        fileId: file.id,
        kind: "component",
        name: "StarRating",
        signature: "() => JSX",
        summary: "Stars",
        hash: "h1",
      },
      {
        fileId: file.id,
        kind: "function",
        name: "clamp",
        signature: null,
        summary: null,
        hash: null,
      },
    ]);
    await symbolsRepo.insertMany(db, other.id, [
      {
        fileId: otherFile.id,
        kind: "component",
        name: "Other",
        signature: null,
        summary: null,
        hash: "h2",
      },
    ]);

    const rows = await symbolsRepo.listComponents(db, mine.id);
    expect(rows.map(({ id: _id, ...r }) => r)).toEqual([
      {
        name: "StarRating",
        path: "src/StarRating.tsx",
        signature: "() => JSX",
        summary: "Stars",
        hash: "h1",
      },
    ]);
    const byToken = (tokens: string[]) =>
      symbolsRepo
        .listComponents(db, mine.id, { nameContainsAny: tokens })
        .then((r) => r.map((c) => c.name));
    expect(await byToken(["rating", "zzz"])).toEqual(["StarRating"]);
    expect(await byToken(["%"])).toEqual([]);
    expect(await byToken([])).toEqual([]);
  });
});
