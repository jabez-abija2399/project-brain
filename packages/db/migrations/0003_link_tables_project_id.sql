-- KI-003 fix: feature_files and checklist_items get project_id, and composite FKs on
-- (project_id, <ref>) so a link can only join rows of one project (same idea as 0002).

ALTER TABLE "feature_files" ADD COLUMN "project_id" text;
UPDATE "feature_files" AS ff SET "project_id" = f."project_id"
  FROM "features" AS f WHERE f."id" = ff."feature_id";
-- A link whose file belongs to another project was never valid; drop it.
DELETE FROM "feature_files" AS ff USING "files" AS fi
  WHERE fi."id" = ff."file_id" AND fi."project_id" <> ff."project_id";
ALTER TABLE "feature_files"
  ALTER COLUMN "project_id" SET NOT NULL,
  ADD CONSTRAINT "feature_files_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
  DROP CONSTRAINT "feature_files_feature_id_fkey",
  ADD CONSTRAINT "feature_files_feature_same_project_fk"
  FOREIGN KEY ("project_id", "feature_id") REFERENCES "features" ("project_id", "id") ON DELETE CASCADE,
  DROP CONSTRAINT "feature_files_file_id_fkey",
  ADD CONSTRAINT "feature_files_file_same_project_fk"
  FOREIGN KEY ("project_id", "file_id") REFERENCES "files" ("project_id", "id") ON DELETE CASCADE;

ALTER TABLE "checklist_items" ADD COLUMN "project_id" text;
UPDATE "checklist_items" AS ci SET "project_id" = r."project_id"
  FROM "requests" AS r WHERE r."id" = ci."request_id";
ALTER TABLE "checklist_items"
  ALTER COLUMN "project_id" SET NOT NULL,
  ADD CONSTRAINT "checklist_items_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE,
  DROP CONSTRAINT "checklist_items_request_id_fkey",
  ADD CONSTRAINT "checklist_items_request_same_project_fk"
  FOREIGN KEY ("project_id", "request_id") REFERENCES "requests" ("project_id", "id") ON DELETE CASCADE;
CREATE INDEX "checklist_items_project_idx" ON "checklist_items" ("project_id");
