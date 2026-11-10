import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt, id } from "./columns";
import { projects } from "./projects";

// Roadmap Phase 6a (0055): approval policies, requests and their append-only audit log.

const projectRef = () =>
  text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" });
const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const approvalPolicies = pgTable("approval_policies", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  preset: text("preset", { enum: ["careful", "balanced", "fast"] })
    .notNull()
    .default("balanced"),
  rules: jsonb("rules").$type<unknown[]>().notNull().default([]),
  pausedUntil: at("paused_until"),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "auto",
  "never",
] as const;

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    projectId: projectRef(),
    action: text("action").notNull(),
    risk: text("risk", { enum: ["low", "medium", "high", "locked"] }).notNull(),
    feature: text("feature"),
    path: text("path"),
    agent: text("agent"),
    summary: text("summary").notNull(),
    status: text("status", { enum: APPROVAL_STATUSES }).notNull(),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: at("decided_at"),
    undoneAt: at("undone_at"),
    createdAt: createdAt(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [index("approval_requests_project_status_idx").on(t.projectId, t.status, t.createdAt)],
);

export const approvalAudit = pgTable(
  "approval_audit",
  {
    id: id(),
    projectId: projectRef(),
    event: text("event").notNull(),
    requestId: text("request_id"),
    actorKind: text("actor_kind", { enum: ["owner", "agent", "system"] }).notNull(),
    actorId: text("actor_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("approval_audit_project_idx").on(t.projectId, t.createdAt)],
);

export type ApprovalRequestRow = typeof approvalRequests.$inferSelect;
export type ApprovalPolicyRow = typeof approvalPolicies.$inferSelect;
