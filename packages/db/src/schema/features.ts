import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
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
    // Stable path-derived key a re-index matches on; the user renames `name` only. Null when user-created (0006).
    key: text("key"),
    // The user renamed it, so a re-index keeps it even with no files (KI-037, 0022).
    nameSetByUser: boolean("name_set_by_user").notNull().default(false),
    description: text("description"),
    status: text("status").notNull().default("todo"),
    // FEAT-019: position in the approved plan's build order; null when the feature did not come from a plan (0026).
    buildOrder: integer("build_order"),
    createdAt: createdAt(),
  },
  (t) => ({
    projectNameUniq: uniqueIndex("features_project_name_uniq").on(t.projectId, t.name),
    projectKeyUniq: uniqueIndex("features_project_key_uniq")
      .on(t.projectId, t.key)
      .where(sql`${t.key} IS NOT NULL`),
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
    // 'auto': placed by grouping, replaced on re-index; 'user': moved by the user, kept on re-index (0006).
    placedBy: text("placed_by", { enum: ["auto", "user"] })
      .notNull()
      .default("auto"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.featureId, t.fileId] }),
    onePrimary: uniqueIndex("feature_files_one_primary_uniq")
      .on(t.projectId, t.fileId)
      .where(sql`${t.role} = 'primary'`),
    roleCheck: check("feature_files_role_check", sql`${t.role} IN ('primary', 'shared')`),
    placedByCheck: check("feature_files_placed_by_check", sql`${t.placedBy} IN ('auto', 'user')`),
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
