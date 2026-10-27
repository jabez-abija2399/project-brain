import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { files } from "./code-index";
import { createdAt, id } from "./columns";
import { projects } from "./projects";

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
    projectIdUniq: uniqueIndex("features_project_id_uniq").on(t.projectId, t.id),
    projectIdx: index("features_project_idx").on(t.projectId),
  }),
);

export const featureFiles = pgTable(
  "feature_files",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    featureId: text("feature_id").notNull(),
    fileId: text("file_id").notNull(),
    // 'primary': the one feature the file belongs to; 'shared': used by this feature among 3+ (0005).
    role: text("role", { enum: ["primary", "shared"] })
      .notNull()
      .default("primary"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.featureId, t.fileId] }),
    onePrimary: uniqueIndex("feature_files_one_primary_uniq")
      .on(t.projectId, t.fileId)
      .where(sql`${t.role} = 'primary'`),
    roleCheck: check("feature_files_role_check", sql`${t.role} IN ('primary', 'shared')`),
    featureSameProjectFk: foreignKey({
      name: "feature_files_feature_same_project_fk",
      columns: [t.projectId, t.featureId],
      foreignColumns: [features.projectId, features.id],
    }).onDelete("cascade"),
    fileSameProjectFk: foreignKey({
      name: "feature_files_file_same_project_fk",
      columns: [t.projectId, t.fileId],
      foreignColumns: [files.projectId, files.id],
    }).onDelete("cascade"),
  }),
);

export type Feature = typeof features.$inferSelect;
export type NewFeature = typeof features.$inferInsert;
export type FeatureFile = typeof featureFiles.$inferSelect;
export type NewFeatureFile = typeof featureFiles.$inferInsert;
