import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// Shared counters for rate limits and the daily AI budget (D-010, KI-023, migration 0009).
export const rateCounters = pgTable(
  "rate_counters",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true, mode: "date" }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.key, t.windowStart] }),
    windowIdx: index("rate_counters_window_idx").on(t.windowStart),
  }),
);
