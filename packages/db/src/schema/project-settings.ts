import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { projects } from "./projects";

// Roadmap Phase 10b (0056): settings the owner turns on per project. A missing row means every setting is off.
export const projectSettings = pgTable("project_settings", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Receipts posted as a comment on the repo's pull requests (off by default).
  prReceipts: boolean("pr_receipts").notNull().default(false),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export type ProjectSettings = typeof projectSettings.$inferSelect;
