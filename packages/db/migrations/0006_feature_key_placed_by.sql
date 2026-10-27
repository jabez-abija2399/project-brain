-- FEAT-006 review M1/M2: keys and flags only, no source code.
-- features.key: the stable path-derived key a re-index matches on (e.g. 'reviews'); the user may rename the display
-- name freely. NULL for features the user created. Existing features all came from a grouping run, so key = name.
ALTER TABLE "features" ADD COLUMN "key" text;
UPDATE "features" SET "key" = "name";
CREATE UNIQUE INDEX "features_project_key_uniq" ON "features" ("project_id", "key") WHERE "key" IS NOT NULL;

-- feature_files.placed_by: 'auto' links are replaced on every re-index; 'user' links (a PATCH move) are kept.
ALTER TABLE "feature_files"
  ADD COLUMN "placed_by" text NOT NULL DEFAULT 'auto',
  ADD CONSTRAINT "feature_files_placed_by_check" CHECK ("placed_by" IN ('auto', 'user'));
