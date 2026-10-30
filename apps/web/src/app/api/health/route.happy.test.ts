import { configuredServices } from "@/server/env";
import { createTestDb, servePgliteOverTcp } from "@brain/db/testing";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const originalUrl = process.env.DATABASE_URL;

describe("GET /api/health (reachable DB)", () => {
  let db: PGlite;
  let server: Awaited<ReturnType<typeof servePgliteOverTcp>>;

  beforeEach(async () => {
    db = await createTestDb();
    server = await servePgliteOverTcp(db);
    process.env.DATABASE_URL = server.url;
  });
  afterEach(async () => {
    process.env.DATABASE_URL = originalUrl;
    await server.close();
    await db.close();
  });

  it("AC-001-02 returns 200 with {ok:true,db:true} when the database in DATABASE_URL is reachable", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      db: true,
      services: configuredServices(process.env),
    });
  });
});
