import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";
import { features } from "./features";
import { projects } from "./projects";

// A proposed change to a checklist item: new wording, or dismissing it (never applied without the owner).
export type ChecklistChange = { text: string } | { dismiss: true };

export const requests = pgTable(
  "requests",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    featureId: text("feature_id"),
    text: text("text").notNull(),
    // The agent session the request was made in (0032); null for older ones and those an agent recorded itself.
    sessionId: text("session_id"),
    createdAt: createdAt(),
  },
  (t) => ({
    projectIdx: index("requests_project_idx").on(t.projectId),
    projectSessionIdx: index("requests_project_session_idx").on(t.projectId, t.sessionId),
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
    status: text("status", { enum: ["open", "done", "partial", "missed", "dismissed"] })
      .notNull()
      .default("open"),
    // FEAT-012: flagged instead of guessed; an agent's change waits here until the owner confirms it.
    needsClarification: boolean("needs_clarification").notNull().default(false),
    // FEAT-013: order within the request (the user's order); 0 for items made before 0020.
    position: integer("position").notNull().default(0),
    proposedChange: jsonb("proposed_change").$type<ChecklistChange>(),
    proposedAt: timestamp("proposed_at", { withTimezone: true, mode: "date" }),
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
