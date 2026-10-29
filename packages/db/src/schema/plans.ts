import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { createdAt, id } from "./columns";
import { projects } from "./projects";

// FEAT-019: what plan_project stored. The JSON shapes are checked by the planner (core plan.ts) before they are saved.
export type PlanQuestion = { id: string; text: string; default: string };
export type PlanItem = { text: string; kind: string };
export type PlanFeature = {
  name: string;
  existing: boolean;
  depends_on: string[];
  items: PlanItem[];
};
export type PlanDraftJson = { restated: string[]; features: PlanFeature[] };
export type PlanStatus = "questions" | "draft" | "approved" | "replaced";

export const planDrafts = pgTable(
  "plan_drafts",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["questions", "draft", "approved", "replaced"] }).notNull(),
    ideaText: text("idea_text").notNull(),
    questionsJson: jsonb("questions_json")
      .$type<{ restated: string[]; questions: PlanQuestion[] }>()
      .notNull(),
    answersJson: jsonb("answers_json").$type<Record<string, string>>(),
    draftJson: jsonb("draft_json").$type<PlanDraftJson>(),
    draftHash: text("draft_hash"),
    createdBy: text("created_by").notNull(),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => ({
    projectIdx: index("plan_drafts_project_idx").on(t.projectId, t.createdAt),
    oneDraft: uniqueIndex("plan_drafts_one_draft_uniq")
      .on(t.projectId)
      .where(sql`${t.status} = 'draft'`),
    oneQuestions: uniqueIndex("plan_drafts_one_questions_uniq")
      .on(t.projectId)
      .where(sql`${t.status} = 'questions'`),
  }),
);

export type PlanDraft = typeof planDrafts.$inferSelect;
