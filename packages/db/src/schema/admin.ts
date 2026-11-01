import { date, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";
import { projects } from "./projects";

// AI calls per project per UTC day (0035): the admin AI usage page. Rate counters are pruned after two days.
export const aiUsageDaily = pgTable(
  "ai_usage_daily",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    calls: integer("calls").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.day] }),
    dayIdx: index("ai_usage_daily_day_idx").on(t.day),
  }),
);

// Admin audit log (0035): append-only (a database trigger refuses UPDATE and DELETE). Plain-text ids, no foreign keys,
// so a record outlives the user or project it names.
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: id(),
    adminUserId: text("admin_user_id").notNull(),
    adminLogin: text("admin_login").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (t) => ({ createdIdx: index("admin_audit_created_idx").on(t.createdAt) }),
);

export type AdminAuditEntry = typeof adminAudit.$inferSelect;
