import { index, pgTable, text } from "drizzle-orm/pg-core";
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
