import { describe, expect, it } from "vitest";
import { checkDb } from "./check";

describe("@brain/db checkDb", () => {
  it("AC-001-03 returns {ok:false} within the timeout for an unreachable host", async () => {
    const start = Date.now();
    const result = await checkDb("postgres://x:x@127.0.0.1:1/none", 1500);
    const elapsed = Date.now() - start;
    expect(result).toEqual({ ok: false });
    expect(elapsed).toBeLessThan(3000);
  });

  it("AC-001-03 returns {ok:false} when DATABASE_URL is empty", async () => {
    const result = await checkDb("", 500);
    expect(result).toEqual({ ok: false });
  });
});
