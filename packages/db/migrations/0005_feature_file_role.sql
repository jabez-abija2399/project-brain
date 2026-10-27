-- FEAT-006: a file is in exactly one feature as 'primary', or linked as 'shared' to every feature that uses it
-- (used by 3+ features). Additive: existing links become primary.
ALTER TABLE "feature_files"
  ADD COLUMN "role" text NOT NULL DEFAULT 'primary',
  ADD CONSTRAINT "feature_files_role_check" CHECK ("role" IN ('primary', 'shared'));
CREATE UNIQUE INDEX "feature_files_one_primary_uniq" ON "feature_files" ("project_id", "file_id")
  WHERE "role" = 'primary';
