import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth";

// FEAT-041 (0058): flexible beta limits. id "default" = everyone; id "user:<userId>" = one user's own limits.
// A null limit means no limit.
export const usageLimits = pgTable("usage_limits", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  projects: integer("projects"),
  judgedPerMonth: integer("judged_per_month"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export type UsageLimitsRow = typeof usageLimits.$inferSelect;
