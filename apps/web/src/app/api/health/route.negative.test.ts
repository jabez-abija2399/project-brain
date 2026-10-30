import { configuredServices } from "@/server/env";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const originalUrl = process.env.DATABASE_URL;

describe("GET /api/health (unreachable DB)", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://x:x@127.0.0.1:1/none";
  });
  afterEach(() => {
    process.env.DATABASE_URL = originalUrl;
  });

  it("AC-001-03 returns 503 with {ok:false,db:false} within 3s", async () => {
    const { GET } = await import("./route");
    const start = Date.now();
    const res = await GET();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      db: false,
      services: configuredServices(process.env),
    });
  });

  it("AC-001-03 returns 503 within 3s when the host silently drops packets (no ECONNREFUSED)", async () => {
    // 10.255.255.1 is non-routable: the TCP SYN is never answered, unlike a closed local port.
    process.env.DATABASE_URL = "postgres://x:x@10.255.255.1:5432/none";
    const { GET } = await import("./route");
    const start = Date.now();
    const res = await GET();
    const elapsed = Date.now() - start;
    expect(res.status).toBe(503);
    expect(elapsed).toBeLessThan(3000);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      db: false,
      services: configuredServices(process.env),
    });
  });
});
