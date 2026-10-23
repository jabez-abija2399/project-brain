import { describe, expect, it, vi } from "vitest";

vi.mock("@brain/db", () => ({
  checkDb: vi.fn(async () => ({ ok: true })),
}));

describe("GET /api/health (reachable DB)", () => {
  it("AC-001-02 returns 200 with {ok:true,db:true} when checkDb succeeds", async () => {
    process.env.DATABASE_URL = "postgres://example/db";
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, db: true });
  });
});
