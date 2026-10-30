import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../pglite";
import { createTestDb } from "../testing";
import { rateCountersRepo } from "./index";

describe("KI-023 rateCountersRepo (D-010 Postgres counters, shared by every server instance)", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let db: ReturnType<typeof fromPglite>;
  const minute = new Date("2026-10-28T12:00:00Z");
  beforeEach(async () => {
    pg = await createTestDb();
    db = fromPglite(pg);
  });
  afterEach(async () => {
    await pg.close();
  });

  it("add() is an atomic upsert: concurrent adds each see a distinct running total", async () => {
    const totals = await Promise.all(
      Array.from({ length: 10 }, () => rateCountersRepo.add(db, "index:t1", minute, 1)),
    );
    expect(totals.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Another key and another window count separately.
    expect(await rateCountersRepo.add(db, "index:t2", minute, 1)).toBe(1);
    expect(await rateCountersRepo.add(db, "index:t1", new Date("2026-10-28T12:01:00Z"), 1)).toBe(1);
    // A negative add gives units back.
    expect(await rateCountersRepo.add(db, "index:t1", minute, -4)).toBe(6);
  });

  it("prune() deletes only windows that started before the cut-off", async () => {
    await rateCountersRepo.add(db, "a", new Date("2026-10-26T00:00:00Z"), 1);
    await rateCountersRepo.add(db, "a", minute, 1);
    await rateCountersRepo.prune(db, new Date("2026-10-27T00:00:00Z"));
    expect(await rateCountersRepo.add(db, "a", new Date("2026-10-26T00:00:00Z"), 1)).toBe(1);
    expect(await rateCountersRepo.add(db, "a", minute, 1)).toBe(2);
  });
});
