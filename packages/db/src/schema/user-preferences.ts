import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth";

// Backlog (0057): small per-account preferences. A missing row means none is set.
export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // The "How do you build?" answer (one of core's BUILD_STYLES; checked by the server before it is stored).
  buildStyle: text("build_style"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
