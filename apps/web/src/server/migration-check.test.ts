import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb, fromPglite, servePgliteOverTcp } from "@brain/db/testing";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTests } from "./db";
import { explainMissingMigrations, resetMigrationCheckForTests } from "./migration-check";

// 2026-11-01: production missed migration 0035 and every page failed with "Failed to get session". Now the logs and
// /api/health name the missing migration and the command that adds it.
const dir = join(fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url)));
const ids = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => f.replace(/\.sql$/, ""));

async function behindByOne() {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE "_brain_migrations" ("id" text PRIMARY KEY NOT NULL)`);
  for (const id of ids.slice(0, -1)) {
    await pg.exec(readFileSync(join(dir, `${id}.sql`), "utf8"));
    await pg.query(`insert into "_brain_migrations" (id) values ($1)`, [id]);
  }
  return pg;
}

beforeEach(() => resetMigrationCheckForTests());
afterEach(() => {
  setDbForTests(null);
  vi.restoreAllMocks();
});

describe("missing migrations", () => {
  it("a failing session lookup on a database behind the code names the missing migration and the fix", async () => {
    const pg = await behindByOne();
    const db = fromPglite(pg);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = await explainMissingMigrations(
      () => db,
      async () => {
        throw new Error("Failed to get session");
      },
    ).catch((e: Error) => e);
    expect((err as Error).message).toContain(`missing 1 migration(s): ${ids.at(-1)}`);
    expect((err as Error).message).toContain("pnpm --filter @brain/db migrate");
    expect(((err as Error).cause as Error).message).toBe("Failed to get session");
    expect(log).toHaveBeenCalledWith(expect.stringContaining(String(ids.at(-1))));
    await pg.close();
  });

  it("on an up-to-date database the original error is rethrown unchanged, and success is untouched", async () => {
    const pg = await createTestDb();
    const db = fromPglite(pg);
    const original = new Error("boom");
    expect(
      await explainMissingMigrations(
        () => db,
        async () => "ok",
      ),
    ).toBe("ok");
    expect(
      await explainMissingMigrations(
        () => db,
        async () => Promise.reject(original),
      ).catch((e) => e),
    ).toBe(original);
    await pg.close();
  });

  it("/api/health answers 503 and lists the pending migration ids (never data) when the database is behind", async () => {
    const pg = await behindByOne();
    const server = await servePgliteOverTcp(pg);
    const url = process.env.DATABASE_URL;
    process.env.DATABASE_URL = server.url;
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { GET } = await import("@/app/api/health/route");
      const res = await GET();
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, db: true, migrations: { pending: [ids.at(-1)] } });
    } finally {
      process.env.DATABASE_URL = url;
      await server.close();
      await pg.close();
    }
  });
});
