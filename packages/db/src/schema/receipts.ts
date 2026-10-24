import { foreignKey, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";
import { features } from "./features";
import { projects } from "./projects";

export const requests = pgTable(
  "requests",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    featureId: text("feature_id"),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    projectIdx: index("requests_project_idx").on(t.projectId),
    projectIdUniq: uniqueIndex("requests_project_id_uniq").on(t.projectId, t.id),
    // SQL uses ON DELETE SET NULL ("feature_id") so project_id stays (0002_same_project_refs.sql).
    featureSameProjectFk: foreignKey({
      name: "requests_feature_same_project_fk",
      columns: [t.projectId, t.featureId],
      foreignColumns: [features.projectId, features.id],
    }).onDelete("set null"),
  }),
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    text: text("text").notNull(),
    status: text("status").notNull().default("open"),
  },
  (t) => ({
    requestIdx: index("checklist_items_request_idx").on(t.requestId),
    projectIdx: index("checklist_items_project_idx").on(t.projectId),
    requestSameProjectFk: foreignKey({
      name: "checklist_items_request_same_project_fk",
      columns: [t.projectId, t.requestId],
      foreignColumns: [requests.projectId, requests.id],
    }).onDelete("cascade"),
  }),
);

export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestId: text("request_id"),
    commitSha: text("commit_sha"),
    summaryJson: jsonb("summary_json"),
    createdAt: createdAt(),
  },
  (t) => ({
    projectCreatedIdx: index("receipts_project_created_idx").on(t.projectId, t.createdAt),
    // SQL uses ON DELETE SET NULL ("request_id") so project_id stays (0002_same_project_refs.sql).
    requestSameProjectFk: foreignKey({
      name: "receipts_request_same_project_fk",
      columns: [t.projectId, t.requestId],
      foreignColumns: [requests.projectId, requests.id],
    }).onDelete("set null"),
  }),
);

export type Request = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type NewChecklistItem = typeof checklistItems.$inferInsert;
export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
