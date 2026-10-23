import { describe, expect, it } from "vitest";
import { checkDb } from "./check";

describe("@brain/db checkDb", () => {
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
