import { describe, expect, it } from "vitest";
import { createTestDb } from "./testing";

describe("@brain/db PGlite test helper", () => {
  it("AC-001-01 createTestDb runs SELECT 1 against an in-process Postgres", async () => {
    const db = await createTestDb();
    try {
      const result = await db.query<{ ok: number }>("select 1 as ok");
      expect(result.rows[0]?.ok).toBe(1);
    } finally {
      await db.close();
    }
  });
});
