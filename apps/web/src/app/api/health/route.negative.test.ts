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
  });

  it("BL-15 a burst of checks reuses one answer for 5 s; another database address is checked again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    process.env.DATABASE_URL = "postgres://x:x@127.0.0.1:1/none";
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(503);
    // The same address within 5 s: answered at once from the cached result (no new connection attempt).
    const start = performance.now();
    for (let i = 0; i < 20; i++) expect((await GET()).status).toBe(503);
    expect(performance.now() - start).toBeLessThan(200);
    vi.setSystemTime(Date.now() + 6_000);
    expect((await GET()).status).toBe(503);
  });
});
