import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { files } from "./code-index";
import { createdAt, id } from "./columns";
import { features } from "./features";
import { projects } from "./projects";
import { checklistItems } from "./receipts";

// Roadmap Phase 3a (0054): the Project Blueprint. Only new tables; features, decisions and directives are reused.

const projectRef = () =>
  text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" });
const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const blueprints = pgTable("blueprints", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  currentVersion: integer("current_version").notNull().default(0),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

export const BLUEPRINT_VERSION_REASONS = [
  "edit",
  "accept_proposal",
  "restore",
  "plan_approve",
] as const;
export type BlueprintVersionReason = (typeof BLUEPRINT_VERSION_REASONS)[number];

export const blueprintVersions = pgTable(
  "blueprint_versions",
  {
    id: id(),
    projectId: projectRef(),
    version: integer("version").notNull(),
    // A BlueprintSnapshot (packages/core blueprint/snapshot.ts), validated before it is written. Immutable (trigger).
    snapshot: jsonb("snapshot").$type<unknown>().notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    reason: text("reason", { enum: BLUEPRINT_VERSION_REASONS }).notNull(),
    restoredFrom: integer("restored_from"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("blueprint_versions_project_version_uniq").on(t.projectId, t.version)],
);

export const featureDependencies = pgTable(
  "feature_dependencies",
  {
    projectId: projectRef(),
    featureId: text("feature_id").notNull(),
    dependsOnId: text("depends_on_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.featureId, t.dependsOnId] }),
    foreignKey({
      columns: [t.projectId, t.featureId],
      foreignColumns: [features.projectId, features.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.projectId, t.dependsOnId],
      foreignColumns: [features.projectId, features.id],
    }).onDelete("cascade"),
  ],
);

export const featureAreas = pgTable(
  "feature_areas",
  {
    projectId: projectRef(),
    featureId: text("feature_id").notNull(),
    pattern: text("pattern").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.featureId, t.pattern] }),
    foreignKey({
      columns: [t.projectId, t.featureId],
      foreignColumns: [features.projectId, features.id],
    }).onDelete("cascade"),
  ],
);

export const CRITERION_KINDS = ["behaviour", "must_never", "security"] as const;
export const CRITERION_STATUSES = ["proposal", "active", "retired"] as const;

export const criteria = pgTable(
  "criteria",
  {
    id: id(),
    projectId: projectRef(),
    featureId: text("feature_id").notNull(),
    // The plain sentence, masked and on one line (at most 300 characters).
    text: text("text").notNull(),
    // Its EARS form (packages/core blueprint/ears.ts), or null when the sentence is not in EARS form yet.
    ears: jsonb("ears").$type<Record<string, unknown> | null>(),
    kind: text("kind", { enum: CRITERION_KINDS }).notNull(),
    status: text("status", { enum: CRITERION_STATUSES }).notNull().default("proposal"),
    createdBy: text("created_by", { enum: ["agent", "owner"] }).notNull(),
    // An agent's proposed rewording ({text}) or retirement ({retire: true}); the owner accepts or dismisses it.
    proposedChange: jsonb("proposed_change").$type<{ text?: string; retire?: true } | null>(),
    proposedAt: at("proposed_at"),
    checklistItemId: text("checklist_item_id"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    confirmedAt: at("confirmed_at"),
  },
  (t) => [
    uniqueIndex("criteria_project_id_uniq").on(t.projectId, t.id),
    index("criteria_project_feature_status_idx").on(t.projectId, t.featureId, t.status),
    foreignKey({
      columns: [t.projectId, t.featureId],
      foreignColumns: [features.projectId, features.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.projectId, t.checklistItemId],
      foreignColumns: [checklistItems.projectId, checklistItems.id],
    }),
  ],
);

export const criterionTests = pgTable(
  "criterion_tests",
  {
    projectId: projectRef(),
    criterionId: text("criterion_id").notNull(),
    fileId: text("file_id").notNull(),
    testName: text("test_name"),
  },
  (t) => [
    uniqueIndex("criterion_tests_uniq").on(
      t.criterionId,
      t.fileId,
      sql`COALESCE(${t.testName}, '')`,
    ),
    foreignKey({
      columns: [t.projectId, t.criterionId],
      foreignColumns: [criteria.projectId, criteria.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.projectId, t.fileId],
      foreignColumns: [files.projectId, files.id],
    }).onDelete("cascade"),
  ],
);

export const BOUNDARY_KINDS = [
  "protected_path",
  "allowed_dependency",
  "disallowed_dependency",
] as const;

export const boundaries = pgTable(
  "boundaries",
  {
    id: id(),
    projectId: projectRef(),
    kind: text("kind", { enum: BOUNDARY_KINDS }).notNull(),
    pattern: text("pattern").notNull(),
    note: text("note"),
    status: text("status", { enum: ["proposal", "active", "dismissed"] })
      .notNull()
      .default("proposal"),
    createdBy: text("created_by", { enum: ["agent", "owner"] }).notNull(),
    createdAt: createdAt(),
    confirmedAt: at("confirmed_at"),
  },
  (t) => [index("boundaries_project_status_idx").on(t.projectId, t.status)],
);

export type Criterion = typeof criteria.$inferSelect;
export type Boundary = typeof boundaries.$inferSelect;
export type BlueprintVersion = typeof blueprintVersions.$inferSelect;
