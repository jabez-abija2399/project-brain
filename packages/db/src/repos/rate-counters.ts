import { lt, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { rateCounters } from "../schema";

// Counters shared by every server instance (D-010). Keys hold ids only, never a token or user input.
export const rateCountersRepo = {
  /** Adds n (may be negative) to the counter of key in the window and returns the new total, atomically. */
  async add(db: BrainDb, key: string, windowStart: Date, n: number): Promise<number> {
    const [row] = await db
      .insert(rateCounters)
      .values({ key, windowStart, count: n })
      .onConflictDoUpdate({
        target: [rateCounters.key, rateCounters.windowStart],
        set: { count: sql`${rateCounters.count} + ${n}` },
      })
      .returning({ count: rateCounters.count });
    if (!row) throw new Error("upsert rate_counters returned no row");
    return row.count;
  },

  /** Deletes every window that started before the cut-off. */
  async prune(db: BrainDb, before: Date): Promise<void> {
    await db.delete(rateCounters).where(lt(rateCounters.windowStart, before));
  },
};
