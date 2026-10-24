import { boolean, foreignKey, index, pgTable, text } from "drizzle-orm/pg-core";
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
    fileId: text("file_id").notNull(),
    name: text("name").notNull(),
    rlsEnabled: boolean("rls_enabled").notNull().default(false),
  },
  (t) => ({
    projectIdx: index("db_tables_project_idx").on(t.projectId),
    fileSameProjectFk: foreignKey({
      name: "db_tables_file_same_project_fk",
      columns: [t.projectId, t.fileId],
      foreignColumns: [files.projectId, files.id],
    }).onDelete("cascade"),
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

export type DbTable = typeof dbTables.$inferSelect;
export type NewDbTable = typeof dbTables.$inferInsert;
export type DbPolicy = typeof dbPolicies.$inferSelect;
export type NewDbPolicy = typeof dbPolicies.$inferInsert;
