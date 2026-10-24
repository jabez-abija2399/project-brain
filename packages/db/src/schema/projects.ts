import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    projectIdx: index("project_tokens_project_idx").on(t.projectId),
  }),
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectToken = typeof projectTokens.$inferSelect;
export type NewProjectToken = typeof projectTokens.$inferInsert;
