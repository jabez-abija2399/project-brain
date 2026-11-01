import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../pglite";
import { createTestDb } from "../testing";
import {
  checklistItemsRepo,
  dashboardRepo,
  featuresRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
  usersRepo,
} from "./index";

// Feature board (2026-11-01): each feature with its progress (done of total items, dismissed left out) and the next
// open item; sorted by name, most open or most recent receipt; status counts over the whole project. Scoped by
// project: another project's features and items never count.
describe("feature board", () => {
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
  async function items(projectId: string, featureId: string, texts: [string, string][]) {
    const { request, items: created } = await requestsRepo.createWithItems(
      db,
      projectId,
      { featureId, text: "r" },
      texts.map(([text]) => ({ text, needsClarification: false })),
    );
    await checklistItemsRepo.setStatuses(
      db,
      projectId,
      created.flatMap((c, i) => {
        const s = texts[i]?.[1];
        return s === "done" || s === "partial" || s === "missed" ? [{ id: c.id, status: s }] : [];
      }),
    );
    return request;
  }

  it("rows carry progress and the next open item; sort by name, most open, or most recent receipt", async () => {
    const a = await project("a");
    const b = await project("b");
    const alpha = await featuresRepo.insert(db, a.id, { name: "Alpha", key: "alpha" });
    const beta = await featuresRepo.insert(db, a.id, { name: "Beta", key: "beta" });
    await featuresRepo.insert(db, a.id, { name: "Gamma", key: "gamma" });
    await items(a.id, alpha.id, [
      ["Show the list", "done"],
      ["Sort newest first", "missed"],
    ]);
    const req = await items(a.id, beta.id, [
      ["Add the form", "open"],
      ["Validate the email", "open"],
      ["Send the email", "done"],
    ]);
    await receiptsRepo.insert(db, a.id, { requestId: req.id, summaryJson: {} });
    const other = await featuresRepo.insert(db, b.id, { name: "Alpha", key: "alpha" });
    await items(b.id, other.id, [["Theirs", "done"]]);

    const byName = await dashboardRepo.featureBoard(db, a.id, 50, 0);
    expect(
      byName.rows.map((r) => [r.name, r.doneItems, r.totalItems, r.openItems, r.nextItem]),
    ).toEqual([
      ["Alpha", 1, 2, 1, "Sort newest first"],
      ["Beta", 1, 3, 2, "Add the form"],
      ["Gamma", 0, 0, 0, null],
    ]);
    expect(
      (await dashboardRepo.featureBoard(db, a.id, 50, 0, "open")).rows.map((r) => r.name),
    ).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(
      (await dashboardRepo.featureBoard(db, a.id, 50, 0, "recent")).rows.map((r) => r.name),
    ).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("counts features by status and those with open items, for this project only", async () => {
    const a = await project("a");
    const b = await project("b");
    const one = await featuresRepo.insert(db, a.id, { name: "One", key: "one" });
    await featuresRepo.insert(db, a.id, { name: "Two", key: "two" });
    await pg.query("UPDATE features SET status = 'done' WHERE id = $1", [one.id]);
    await items(a.id, one.id, [["Open thing", "open"]]);
    await featuresRepo.insert(db, b.id, { name: "Three", key: "three" });
    expect(await dashboardRepo.featureCounts(db, a.id)).toEqual({
      total: 2,
      todo: 1,
      inProgress: 0,
      done: 1,
      withOpenItems: 1,
    });
  });
});
