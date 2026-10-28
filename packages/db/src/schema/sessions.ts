import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createdAt, id } from "./columns";
import { projects } from "./projects";

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

export const directives = pgTable(
  "directives",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    // 'proposal' until the project owner confirms it in the dashboard; only 'active' reaches where_did_we_stop.
    status: text("status", { enum: ["proposal", "active", "dismissed"] })
      .notNull()
      .default("proposal"),
    createdBy: text("created_by", { enum: ["agent", "owner"] }).notNull(),
    createdAt: createdAt(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    projectStatusIdx: index("directives_project_status_idx").on(t.projectId, t.status),
  }),
);

export type AgentSession = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
export type Directive = typeof directives.$inferSelect;
export type NewDirective = typeof directives.$inferInsert;
