import type { BrainDb } from "@brain/db";
import { afterEach, describe, expect, it } from "vitest";
import { missingMigrations, resetMigrationCheckForTests } from "./migration-check";

// 2026-11-11 production log: a brief database error was read as "all 31 migrations missing" and cached for a minute.
const failing = (code: string) =>
  ({
    select: () => ({
      from: () => Promise.reject(Object.assign(new Error("boom"), { code })),
    }),
  }) as unknown as BrainDb;
const answering = (ids: string[]) =>
  ({
    select: () => ({ from: () => Promise.resolve(ids.map((id) => ({ id }))) }),
  }) as unknown as BrainDb;

afterEach(() => resetMigrationCheckForTests());

describe("migration check on a flaky database", () => {
  it("BL-52 a connection error reports nothing missing and is not cached; the next call asks again", async () => {
    expect(await missingMigrations(failing("57P01"), 1_000)).toEqual([]);
    const pending = await missingMigrations(answering([]), 2_000);
    expect(pending.length).toBeGreaterThan(30);
  });

  it("BL-53 a missing tracking table still means every migration is missing", async () => {
    expect((await missingMigrations(failing("42P01"), 1_000)).length).toBeGreaterThan(30);
  });
});
