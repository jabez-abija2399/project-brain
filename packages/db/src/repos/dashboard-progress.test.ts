import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../pglite";
import { createTestDb } from "../testing";
import {
  checklistItemsRepo,
  dashboardRepo,
  featuresRepo,
  projectsRepo,
  requestsRepo,
  usersRepo,
} from "./index";

// Overview (2026-11-01): checklist items counted by status, for the project and per feature (most open first), in one
// bounded query each, never reaching another project.
describe("dashboard item progress", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let db: ReturnType<typeof fromPglite>;
  beforeEach(async () => {
    pg = await createTestDb();
    db = fromPglite(pg);
  });
  afterEach(async () => {
    await pg.close();
  });

  async function project(name: string) {
    await usersRepo.upsertById(db, { id: `owner-${name}`, name, email: `${name}@example.com` });
    return projectsRepo.create(db, `owner-${name}`, { name });
  }
  async function items(projectId: string, featureId: string | null, statuses: string[]) {
    const { items: created } = await requestsRepo.createWithItems(
      db,
      projectId,
      { featureId, text: "r" },
      statuses.map((_, i) => ({ text: `item ${i}`, needsClarification: false })),
    );
    await checklistItemsRepo.setStatuses(
      db,
      projectId,
      created.flatMap((c, i) => {
        const s = statuses[i];
        return s === "open" || s === "dismissed"
          ? []
          : [{ id: c.id, status: s as "done" | "partial" | "missed" }];
      }),
    );
  }

  it("counts items by status and per feature, most open first, for this project only", async () => {
    const a = await project("a");
    const b = await project("b");
    const reviews = await featuresRepo.insert(db, a.id, { name: "Reviews", key: "reviews" });
    const home = await featuresRepo.insert(db, a.id, { name: "home", key: "@home" });
    await featuresRepo.insert(db, a.id, { name: "Empty", key: "empty" });
    await items(a.id, reviews.id, ["done", "done", "missed", "open"]);
    await items(a.id, home.id, ["done", "partial"]);
    await items(a.id, null, ["missed"]);
    const other = await featuresRepo.insert(db, b.id, { name: "Other", key: "other" });
    await items(b.id, other.id, ["missed", "missed", "missed"]);

    expect(await dashboardRepo.itemCounts(db, a.id)).toEqual({
      open: 1,
      done: 3,
      partial: 1,
      missed: 2,
      dismissed: 0,
      // Real-test G and H (2026-11-01): the two new states are counted too.
      postponed: 0,
      done_untested: 0,
    });
    expect(await dashboardRepo.featureProgress(db, a.id, 8)).toEqual([
      { id: reviews.id, name: "Reviews", total: 4, done: 2, open: 2 },
      { id: home.id, name: "home", total: 2, done: 1, open: 1 },
    ]);
    expect(await dashboardRepo.featureProgress(db, a.id, 1)).toHaveLength(1);
  });
});
