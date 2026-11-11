import { configuredServices } from "@/server/env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("GET /api/health cache (backlog)", () => {
  afterEach(() => {
    process.env.DATABASE_URL = originalUrl;
    vi.useRealTimers();
    vi.doUnmock("@brain/db");
    vi.resetModules();
  });

  it("BL-15 one database check serves a burst of requests for 5 s, and concurrent ones share it", async () => {
    vi.resetModules();
    let checks = 0;
    vi.doMock("@brain/db", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@brain/db")>()),
      checkDb: async () => {
        checks++;
        await new Promise((r) => setTimeout(r, 20));
        return { ok: false, reason: "down" };
      },
    }));
    vi.useFakeTimers({ toFake: ["Date"] });
    process.env.DATABASE_URL = "postgres://x:x@127.0.0.1:1/cache-test";
    const { GET } = await import("./route");
    const burst = await Promise.all(Array.from({ length: 10 }, () => GET()));
    expect(burst.every((r) => r.status === 503)).toBe(true);
    expect(checks).toBe(1);
    for (let i = 0; i < 10; i++) await GET();
    expect(checks).toBe(1);
    vi.setSystemTime(Date.now() + 6_000);
    await GET();
    expect(checks).toBe(2);
  });
});
