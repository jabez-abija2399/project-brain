-- Roadmap Phase 10b (2026-11-11): per-project settings the owner turns on. First one: receipts posted on pull
-- requests (off by default). Additive only: one new table. Optional (the setting reads as off before it).

CREATE TABLE "project_settings" (
  "project_id" text PRIMARY KEY NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "pr_receipts" boolean NOT NULL DEFAULT false,
  "updated_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
