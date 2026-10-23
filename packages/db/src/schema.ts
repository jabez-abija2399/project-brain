import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().default(sql`now()`);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    repoFullName: text("repo_full_name"),
    createdAt: createdAt(),
  },
  (t) => ({
    ownerRepoUniq: uniqueIndex("projects_owner_repo_uniq").on(t.ownerId, t.repoFullName),
    ownerIdx: index("projects_owner_idx").on(t.ownerId),
  }),
);

export const projectTokens = pgTable(
  "project_tokens",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    hash: text("hash").notNull().unique(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    projectIdx: index("project_tokens_project_idx").on(t.projectId),
  }),
);

export const files = pgTable(
  "files",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    hash: text("hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    projectPathUniq: uniqueIndex("files_project_path_uniq").on(t.projectId, t.path),
    projectIdx: index("files_project_idx").on(t.projectId),
  }),
);

export const symbols = pgTable(
  "symbols",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    signature: text("signature"),
    summary: text("summary"),
    createdAt: createdAt(),
  },
  (t) => ({
    projectKindNameIdx: index("symbols_project_kind_name_idx").on(t.projectId, t.kind, t.name),
    projectIdx: index("symbols_project_idx").on(t.projectId),
  }),
);

export const features = pgTable(
  "features",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"),
    createdAt: createdAt(),
  },
  (t) => ({
    projectNameUniq: uniqueIndex("features_project_name_uniq").on(t.projectId, t.name),
    projectIdx: index("features_project_idx").on(t.projectId),
  }),
);

export const featureFiles = pgTable(
  "feature_files",
  {
    featureId: text("feature_id")
      .notNull()
      .references(() => features.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.featureId, t.fileId] }),
  }),
);

export const decisions = pgTable(
  "decisions",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => ({
    projectIdx: index("decisions_project_idx").on(t.projectId),
  }),
);

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    goal: text("goal"),
    done: text("done"),
    unfinished: text("unfinished"),
    nextStep: text("next_step"),
    createdAt: createdAt(),
  },
  (t) => ({
    projectIdx: index("agent_sessions_project_idx").on(t.projectId),
  }),
);

export const requests = pgTable(
  "requests",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    featureId: text("feature_id").references(() => features.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    projectIdx: index("requests_project_idx").on(t.projectId),
  }),
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: id(),
    requestId: text("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    status: text("status").notNull().default("open"),
  },
  (t) => ({
    requestIdx: index("checklist_items_request_idx").on(t.requestId),
  }),
);

export const receipts = pgTable(
  "receipts",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestId: text("request_id").references(() => requests.id, { onDelete: "set null" }),
    commitSha: text("commit_sha"),
    summaryJson: jsonb("summary_json"),
    createdAt: createdAt(),
  },
  (t) => ({
    projectCreatedIdx: index("receipts_project_created_idx").on(t.projectId, t.createdAt),
  }),
);

export const dbTables = pgTable(
  "db_tables",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rlsEnabled: boolean("rls_enabled").notNull().default(false),
  },
  (t) => ({
    projectIdx: index("db_tables_project_idx").on(t.projectId),
  }),
);

export const dbPolicies = pgTable(
  "db_policies",
  {
    id: id(),
    tableId: text("table_id")
      .notNull()
      .references(() => dbTables.id, { onDelete: "cascade" }),
    command: text("command").notNull(),
    allowsAll: boolean("allows_all").notNull().default(false),
    checksOwnership: boolean("checks_ownership").notNull().default(false),
  },
  (t) => ({
    tableIdx: index("db_policies_table_idx").on(t.tableId),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type Symbol = typeof symbols.$inferSelect;
export type NewSymbol = typeof symbols.$inferInsert;
export type Feature = typeof features.$inferSelect;
export type NewFeature = typeof features.$inferInsert;
export type Request = typeof requests.$inferSelect;
export type NewRequest = typeof requests.$inferInsert;
export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
