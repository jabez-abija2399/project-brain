// Launch security pass (independent review): repository-level attacks on `npx codeceipt` device codes.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../pglite";
import { createTestDb } from "../testing";
import { deviceCodesRepo, projectsRepo, usersRepo } from "./index";

const T0 = new Date("2026-10-30T10:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("launch: device codes repository security", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let db: ReturnType<typeof fromPglite>;
  let p1: string;
  beforeEach(async () => {
    pg = await createTestDb();
    db = fromPglite(pg);
    await usersRepo.upsertById(db, { id: "u1", name: "u1", email: "u1@example.com" });
    p1 = (await projectsRepo.create(db, "u1", { name: "A" })).id;
  });
  afterEach(async () => {
    await pg.close();
  });

  const make = (hash: string, userCode: string, expiresAt = at(600)) =>
    deviceCodesRepo.create(
      db,
      { deviceCodeHash: hash, userCode, suggestedName: null, expiresAt },
      T0,
    );

  it("attack: two concurrent polls of an approved code mint exactly one token", async () => {
    await make(HASH_A, "BCDF-GHJK");
    expect(
      await deviceCodesRepo.decide(db, "BCDF-GHJK", { userId: "u1", projectId: p1 }, at(1)),
    ).toBe(true);
    const results = await Promise.all([
      deviceCodesRepo.poll(db, HASH_A, at(10), 5000),
      deviceCodesRepo.poll(db, HASH_A, at(20), 5000),
      deviceCodesRepo.poll(db, HASH_A, at(30), 5000),
    ]);
    expect(results.filter((r) => r.status === "approved")).toHaveLength(1);
    const { rows } = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM project_tokens WHERE project_id = $1",
      [p1],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("attack: an approved code polled after it expired yields no token", async () => {
    await make(HASH_A, "BCDF-GHJK");
    await deviceCodesRepo.decide(db, "BCDF-GHJK", { userId: "u1", projectId: p1 }, at(1));
    expect(await deviceCodesRepo.poll(db, HASH_A, at(600), 5000)).toEqual({ status: "expired" });
    expect(await deviceCodesRepo.poll(db, HASH_A, at(9999), 5000)).toEqual({ status: "expired" });
  });

  it("attack: a used or denied code cannot be re-decided (approve after deny, re-approve after use)", async () => {
    await make(HASH_A, "BCDF-GHJK");
    await deviceCodesRepo.decide(db, "BCDF-GHJK", { userId: "u1", deny: true }, at(1));
    expect(
      await deviceCodesRepo.decide(db, "BCDF-GHJK", { userId: "u1", projectId: p1 }, at(2)),
    ).toBe(false);
    expect(await deviceCodesRepo.poll(db, HASH_A, at(10), 5000)).toEqual({ status: "denied" });

    await make(HASH_B, "CDFG-HJKL");
    await deviceCodesRepo.decide(db, "CDFG-HJKL", { userId: "u1", projectId: p1 }, at(1));
    expect((await deviceCodesRepo.poll(db, HASH_B, at(10), 5000)).status).toBe("approved");
    expect(
      await deviceCodesRepo.decide(db, "CDFG-HJKL", { userId: "u1", projectId: p1 }, at(11)),
    ).toBe(false);
    expect(await deviceCodesRepo.poll(db, HASH_B, at(20), 5000)).toEqual({ status: "invalid" });
  });

  it("attack: a reused user code (after the first was approved) never hands the first code's approval to the second device", async () => {
    await make(HASH_A, "BCDF-GHJK");
    await deviceCodesRepo.decide(db, "BCDF-GHJK", { userId: "u1", projectId: p1 }, at(1));
    // The same short code may be issued again once the first is no longer pending.
    expect(await make(HASH_B, "BCDF-GHJK")).not.toBeNull();
    expect(await deviceCodesRepo.poll(db, HASH_B, at(10), 5000)).toEqual({ status: "pending" });
    expect((await deviceCodesRepo.poll(db, HASH_A, at(10), 5000)).status).toBe("approved");
  });

  it("attack: two pending codes can never share a user code", async () => {
    expect(await make(HASH_A, "BCDF-GHJK")).not.toBeNull();
    expect(await make(HASH_B, "BCDF-GHJK")).toBeNull();
  });

  it("attack: polling faster than the interval is slow_down, and slow_down still counts as a poll", async () => {
    await make(HASH_A, "BCDF-GHJK");
    expect(await deviceCodesRepo.poll(db, HASH_A, at(5), 5000)).toEqual({ status: "pending" });
    expect(await deviceCodesRepo.poll(db, HASH_A, at(9), 5000)).toEqual({ status: "slow_down" });
    // Hammering every 4 s never gets through to a real answer.
    expect(await deviceCodesRepo.poll(db, HASH_A, at(13), 5000)).toEqual({ status: "slow_down" });
  });
});
