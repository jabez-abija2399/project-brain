-- Roadmap Phase 3a (2026-11-07): the Project Blueprint. A versioned description of what the project should be:
-- features (purpose, build order, depends_on, mapped areas), criteria (a plain sentence with an EARS form behind it,
-- a kind and links to tests), boundaries (protected paths, allowed and disallowed dependencies). Rules and decisions
-- stay in "directives" and "decisions". Additive only: new tables, one unique index, one function and trigger. No
-- column is added to an existing table, so code that does not use the Blueprint runs the same before and after.

-- One row per project with a Blueprint: its current version number.
CREATE TABLE "blueprints" (
  "project_id" text PRIMARY KEY NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "current_version" integer NOT NULL DEFAULT 0,
  "updated_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Every saved state of a Blueprint, never changed after it is written (restore writes a new version).
CREATE TABLE "blueprint_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "version" integer NOT NULL,
  "snapshot" jsonb NOT NULL,
  "snapshot_hash" text NOT NULL,
  "reason" text NOT NULL,
  "restored_from" integer,
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "blueprint_versions_reason_check"
    CHECK ("reason" IN ('edit', 'accept_proposal', 'restore', 'plan_approve')),
  CONSTRAINT "blueprint_versions_size_check" CHECK (octet_length("snapshot"::text) <= 262144)
);
CREATE UNIQUE INDEX "blueprint_versions_project_version_uniq" ON "blueprint_versions" ("project_id", "version");
CREATE FUNCTION "blueprint_versions_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'blueprint_versions rows are immutable';
END;
$$;
CREATE TRIGGER "blueprint_versions_no_update" BEFORE UPDATE ON "blueprint_versions"
  FOR EACH ROW EXECUTE FUNCTION "blueprint_versions_immutable"();

-- depends_on between features of the same project (a feature never depends on itself).
CREATE TABLE "feature_dependencies" (
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "feature_id" text NOT NULL,
  "depends_on_id" text NOT NULL,
  PRIMARY KEY ("feature_id", "depends_on_id"),
  CONSTRAINT "feature_dependencies_not_self" CHECK ("feature_id" <> "depends_on_id"),
  FOREIGN KEY ("project_id", "feature_id") REFERENCES "features" ("project_id", "id") ON DELETE CASCADE,
  FOREIGN KEY ("project_id", "depends_on_id") REFERENCES "features" ("project_id", "id") ON DELETE CASCADE
);

-- Mapped areas of a feature: repo path globs (paths only, never code).
CREATE TABLE "feature_areas" (
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "feature_id" text NOT NULL,
  "pattern" text NOT NULL,
  PRIMARY KEY ("feature_id", "pattern"),
  CONSTRAINT "feature_areas_pattern_len" CHECK (char_length("pattern") BETWEEN 1 AND 200),
  FOREIGN KEY ("project_id", "feature_id") REFERENCES "features" ("project_id", "id") ON DELETE CASCADE
);

-- A checklist item can be the work that delivered a criterion: same-project link (needs this unique index).
CREATE UNIQUE INDEX "checklist_items_project_id_uniq" ON "checklist_items" ("project_id", "id");

-- Lasting requirements of a feature. Agents only propose (status 'proposal'); the owner makes them active.
CREATE TABLE "criteria" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "feature_id" text NOT NULL,
  "text" text NOT NULL,
  "ears" jsonb,
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'proposal',
  "created_by" text NOT NULL,
  "proposed_change" jsonb,
  "proposed_at" timestamptz,
  "checklist_item_id" text,
  "position" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "confirmed_at" timestamptz,
  CONSTRAINT "criteria_kind_check" CHECK ("kind" IN ('behaviour', 'must_never', 'security')),
  CONSTRAINT "criteria_status_check" CHECK ("status" IN ('proposal', 'active', 'retired')),
  CONSTRAINT "criteria_created_by_check" CHECK ("created_by" IN ('agent', 'owner')),
  CONSTRAINT "criteria_text_len" CHECK (char_length("text") BETWEEN 1 AND 300),
  FOREIGN KEY ("project_id", "feature_id") REFERENCES "features" ("project_id", "id") ON DELETE CASCADE,
  FOREIGN KEY ("project_id", "checklist_item_id") REFERENCES "checklist_items" ("project_id", "id")
    ON DELETE SET NULL ("checklist_item_id")
);
CREATE UNIQUE INDEX "criteria_project_id_uniq" ON "criteria" ("project_id", "id");
CREATE INDEX "criteria_project_feature_status_idx" ON "criteria" ("project_id", "feature_id", "status");

-- Tests linked to a criterion: a test file and optionally one test name (names only, never code).
CREATE TABLE "criterion_tests" (
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "criterion_id" text NOT NULL,
  "file_id" text NOT NULL,
  "test_name" text,
  CONSTRAINT "criterion_tests_name_len" CHECK ("test_name" IS NULL OR char_length("test_name") <= 200),
  FOREIGN KEY ("project_id", "criterion_id") REFERENCES "criteria" ("project_id", "id") ON DELETE CASCADE,
  FOREIGN KEY ("project_id", "file_id") REFERENCES "files" ("project_id", "id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "criterion_tests_uniq" ON "criterion_tests" ("criterion_id", "file_id", COALESCE("test_name", ''));

-- Structured boundaries, checked mechanically (plain-language rules stay in "directives").
CREATE TABLE "boundaries" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "pattern" text NOT NULL,
  "note" text,
  "status" text NOT NULL DEFAULT 'proposal',
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "confirmed_at" timestamptz,
  CONSTRAINT "boundaries_kind_check"
    CHECK ("kind" IN ('protected_path', 'allowed_dependency', 'disallowed_dependency')),
  CONSTRAINT "boundaries_status_check" CHECK ("status" IN ('proposal', 'active', 'dismissed')),
  CONSTRAINT "boundaries_created_by_check" CHECK ("created_by" IN ('agent', 'owner')),
  CONSTRAINT "boundaries_pattern_len" CHECK (char_length("pattern") BETWEEN 1 AND 200),
  CONSTRAINT "boundaries_note_len" CHECK ("note" IS NULL OR char_length("note") <= 300)
);
CREATE INDEX "boundaries_project_status_idx" ON "boundaries" ("project_id", "status");
