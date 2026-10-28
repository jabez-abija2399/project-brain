import { foreignKey, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";
import { projects } from "./projects";

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
    projectIdUniq: uniqueIndex("files_project_id_uniq").on(t.projectId, t.id),
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
    fileId: text("file_id").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    signature: text("signature"),
    summary: text("summary"),
    // Hash of the summary inputs (path, name, signature); the summary is regenerated only when it changes (0007).
    hash: text("hash"),
    createdAt: createdAt(),
  },
  (t) => ({
    projectKindNameIdx: index("symbols_project_kind_name_idx").on(t.projectId, t.kind, t.name),
    projectIdx: index("symbols_project_idx").on(t.projectId),
    fileSameProjectFk: foreignKey({
      name: "symbols_file_same_project_fk",
      columns: [t.projectId, t.fileId],
      foreignColumns: [files.projectId, files.id],
    }).onDelete("cascade"),
  }),
);

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type Symbol = typeof symbols.$inferSelect;
export type NewSymbol = typeof symbols.$inferInsert;
