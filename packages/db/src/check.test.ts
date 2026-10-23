import { describe, expect, it } from "vitest";
import { checkDb } from "./check";
import { createTestDb, servePgliteOverTcp } from "./testing";

describe("@brain/db checkDb", () => {
  it("AC-001-02 returns ok:true against a reachable Postgres over TCP", async () => {
    const db = await createTestDb();
    const server = await servePgliteOverTcp(db);
    try {
      await expect(checkDb(server.url, 2500)).resolves.toEqual({ ok: true });
    } finally {
      await server.close();
      await db.close();
    }
  });

  it("AC-001-03 returns ok:false within the timeout for an unreachable host", async () => {
    const start = Date.now();
    const result = await checkDb("postgres://x:x@127.0.0.1:1/none", 1500);
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe("string");
    expect(elapsed).toBeLessThan(3000);
  });

  it("AC-001-03 returns ok:false with 'DATABASE_URL is empty' when the URL is blank", async () => {
    const result = await checkDb("", 500);
    expect(result).toEqual({ ok: false, reason: "DATABASE_URL is empty" });
  });
});
