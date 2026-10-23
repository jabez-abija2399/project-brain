-- FEAT-002: initial product schema (users/sessions tables arrive with better-auth in FEAT-003).
CREATE TABLE "projects" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_id" text NOT NULL,
  "name" text NOT NULL,
  "repo_full_name" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "projects_owner_repo_uniq" ON "projects" ("owner_id", "repo_full_name");
CREATE INDEX "projects_owner_idx" ON "projects" ("owner_id");

CREATE TABLE "project_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "hash" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz
);
CREATE INDEX "project_tokens_project_idx" ON "project_tokens" ("project_id");

CREATE TABLE "files" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "path" text NOT NULL,
  "hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "files_project_path_uniq" ON "files" ("project_id", "path");
CREATE INDEX "files_project_idx" ON "files" ("project_id");

CREATE TABLE "symbols" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "file_id" text NOT NULL REFERENCES "files"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "signature" text,
  "summary" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "symbols_project_kind_name_idx" ON "symbols" ("project_id", "kind", "name");
CREATE INDEX "symbols_project_idx" ON "symbols" ("project_id");

CREATE TABLE "features" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'todo',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "features_project_name_uniq" ON "features" ("project_id", "name");
CREATE INDEX "features_project_idx" ON "features" ("project_id");

CREATE TABLE "feature_files" (
  "feature_id" text NOT NULL REFERENCES "features"("id") ON DELETE CASCADE,
  "file_id" text NOT NULL REFERENCES "files"("id") ON DELETE CASCADE,
  PRIMARY KEY ("feature_id", "file_id")
);

CREATE TABLE "decisions" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "decisions_project_idx" ON "decisions" ("project_id");

CREATE TABLE "agent_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "goal" text,
  "done" text,
  "unfinished" text,
  "next_step" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "agent_sessions_project_idx" ON "agent_sessions" ("project_id");

CREATE TABLE "requests" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "feature_id" text REFERENCES "features"("id") ON DELETE SET NULL,
  "text" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "requests_project_idx" ON "requests" ("project_id");

CREATE TABLE "checklist_items" (
  "id" text PRIMARY KEY NOT NULL,
  "request_id" text NOT NULL REFERENCES "requests"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open'
);
CREATE INDEX "checklist_items_request_idx" ON "checklist_items" ("request_id");

CREATE TABLE "receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "request_id" text REFERENCES "requests"("id") ON DELETE SET NULL,
  "commit_sha" text,
  "summary_json" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "receipts_project_created_idx" ON "receipts" ("project_id", "created_at" DESC);

CREATE TABLE "db_tables" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "file_id" text NOT NULL REFERENCES "files"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "rls_enabled" boolean NOT NULL DEFAULT false
);
CREATE INDEX "db_tables_project_idx" ON "db_tables" ("project_id");

CREATE TABLE "db_policies" (
  "id" text PRIMARY KEY NOT NULL,
  "table_id" text NOT NULL REFERENCES "db_tables"("id") ON DELETE CASCADE,
  "command" text NOT NULL,
  "allows_all" boolean NOT NULL DEFAULT false,
  "checks_ownership" boolean NOT NULL DEFAULT false
);
CREATE INDEX "db_policies_table_idx" ON "db_policies" ("table_id");
