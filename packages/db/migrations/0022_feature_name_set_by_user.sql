-- KI-037: a re-index deletes path-derived features left with no files, unless the user named them. A rename sets
-- this flag (user-created features have key NULL and are never deleted). Existing features whose name is neither
-- their key nor an automatic "-N" variant of it were renamed by the user before this column existed.
ALTER TABLE "features" ADD COLUMN "name_set_by_user" boolean NOT NULL DEFAULT false;
UPDATE "features" SET "name_set_by_user" = true
WHERE "key" IS NOT NULL
  AND "name" <> ltrim("key", '@')
  AND left("name", length(ltrim("key", '@')) + 1) <> ltrim("key", '@') || '-';
