import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text } from "drizzle-orm/pg-core";
import { files } from "./code-index";
import { id } from "./columns";
import { projects } from "./projects";

export const dbTables = pgTable(
  "db_tables",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Optional since FEAT-015: tables uploaded from supabase/migrations keep their migration path instead.
    fileId: text("file_id"),
    path: text("path").notNull().default(""),
    schema: text("schema").notNull().default("public"),
    name: text("name").notNull(),
    rlsEnabled: boolean("rls_enabled").notNull().default(false),
    // RLS state could not be read (unparseable migration statement); never true together with rlsEnabled.
    rlsUnknown: boolean("rls_unknown").notNull().default(false),
  },
  (t) => ({
    projectIdx: index("db_tables_project_idx").on(t.projectId),
    fileSameProjectFk: foreignKey({
      name: "db_tables_file_same_project_fk",
      columns: [t.projectId, t.fileId],
      foreignColumns: [files.projectId, files.id],
    }).onDelete("cascade"),
    unknownNotEnabled: check(
      "db_tables_unknown_not_enabled",
      sql`NOT (${t.rlsEnabled} AND ${t.rlsUnknown})`,
    ),
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
    // AS PERMISSIVE (true) or AS RESTRICTIVE (false); a restrictive policy never allows everyone.
    permissive: boolean("permissive").notNull().default(true),
    allowsAll: boolean("allows_all").notNull().default(false),
    checksOwnership: boolean("checks_ownership").notNull().default(false),
  },
  (t) => ({
    tableIdx: index("db_policies_table_idx").on(t.tableId),
    restrictiveNotAllowsAll: check(
      "db_policies_restrictive_not_allows_all",
      sql`${t.permissive} OR NOT ${t.allowsAll}`,
    ),
  }),
);

export type DbTable = typeof dbTables.$inferSelect;
export type NewDbTable = typeof dbTables.$inferInsert;
export type DbPolicy = typeof dbPolicies.$inferSelect;
export type NewDbPolicy = typeof dbPolicies.$inferInsert;
