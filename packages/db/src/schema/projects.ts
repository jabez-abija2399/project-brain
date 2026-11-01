import { bigint, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt, id } from "./columns";

export const projects = pgTable(
  "projects",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    repoFullName: text("repo_full_name"),
    // FEAT-009: the GitHub App installation the repo was linked through (null = not linked).
    installationId: bigint("installation_id", { mode: "number" }),
    // Admin abuse control (0035): a suspended project's tokens and pages stop working.
    suspendedAt: timestamp("suspended_at", { withTimezone: true, mode: "date" }),
    // Real-test bug J (0038): which repository the project belongs to, as hashed parts "r=<hash>;o=<hash>".
    repoFingerprint: text("repo_fingerprint"),
    createdAt: createdAt(),
  },
  (t) => ({
    ownerRepoUniq: uniqueIndex("projects_owner_repo_uniq").on(t.ownerId, t.repoFullName),
    ownerIdx: index("projects_owner_idx").on(t.ownerId),
    installationRepoIdx: index("projects_installation_repo_idx").on(
      t.installationId,
      t.repoFullName,
    ),
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
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    // What made it (0035): the repo folder from `npx codeceipt`, or null (the Tokens page). Never secret.
    label: text("label"),
  },
  (t) => ({
    projectIdx: index("project_tokens_project_idx").on(t.projectId),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectToken = typeof projectTokens.$inferSelect;
export type NewProjectToken = typeof projectTokens.$inferInsert;
