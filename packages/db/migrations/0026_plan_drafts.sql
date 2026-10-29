-- FEAT-019: project planning. plan_project stores its questions (stage 1) and its draft plan (stage 2) here; nothing
-- becomes active until the project owner approves the draft in the dashboard. At most one open question set and one
-- unapproved draft per project: a newer one replaces the older (status 'replaced').
CREATE TABLE "plan_drafts" (
  "id" text PRIMARY KEY,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  -- The idea as written (secrets masked); never logged.
  "idea_text" text NOT NULL,
  "questions_json" jsonb NOT NULL,
  "answers_json" jsonb,
  "draft_json" jsonb,
  -- sha256 of draft_json: approval must name the draft the owner saw (draft id + hash).
  "draft_hash" text,
  -- The project token that asked for the plan (agents draft, they never approve).
  "created_by" text NOT NULL,
  "approved_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "approved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plan_drafts_status_check" CHECK ("status" IN ('questions', 'draft', 'approved', 'replaced'))
);
CREATE INDEX "plan_drafts_project_idx" ON "plan_drafts" ("project_id", "created_at");
CREATE UNIQUE INDEX "plan_drafts_one_draft_uniq" ON "plan_drafts" ("project_id") WHERE "status" = 'draft';
CREATE UNIQUE INDEX "plan_drafts_one_questions_uniq" ON "plan_drafts" ("project_id") WHERE "status" = 'questions';
-- Position in the approved plan's build order (null for features that did not come from a plan).
ALTER TABLE "features" ADD COLUMN "build_order" integer;
