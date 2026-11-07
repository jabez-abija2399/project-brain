-- Roadmap Phase 2a (2026-11-07): a per-feature cache of a context pack's FILES and COMPONENTS lines, so
-- get_context_pack is one row read instead of three queries in a row. Paths, names and short summaries only (never
-- source code). Additive only: one table, two functions, triggers.
CREATE TABLE "context_pack_cache" (
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "feature_id" text NOT NULL,
  -- Repo-relative paths, in pack order (at most 200).
  "files" jsonb NOT NULL,
  -- How many files the feature has in all (the pack shows the first 200).
  "files_total" integer NOT NULL,
  -- One line per component: name, path, signature, summary (masked before it is shown).
  "components" jsonb NOT NULL,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("project_id", "feature_id"),
  -- Same-project reference (as in 0003): a row can never point at another project's feature.
  FOREIGN KEY ("project_id", "feature_id") REFERENCES "features" ("project_id", "id") ON DELETE CASCADE
);
-- Any change to what a pack is built from clears that project's cache, whichever code path made it, so a cached
-- pack can never be older than the index. Statement-level triggers with transition tables: one DELETE per statement
-- (not per row), so a bulk index upload pays once. The next index step (or push job) builds the entries again.
CREATE FUNCTION "context_pack_cache_clear_new"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "context_pack_cache" WHERE "project_id" IN (SELECT DISTINCT "project_id" FROM new_rows);
  RETURN NULL;
END;
$$;
CREATE FUNCTION "context_pack_cache_clear_old"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "context_pack_cache" WHERE "project_id" IN (SELECT DISTINCT "project_id" FROM old_rows);
  RETURN NULL;
END;
$$;
CREATE TRIGGER "context_pack_cache_files_ins" AFTER INSERT ON "files"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_new"();
CREATE TRIGGER "context_pack_cache_files_upd" AFTER UPDATE ON "files"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_new"();
CREATE TRIGGER "context_pack_cache_files_del" AFTER DELETE ON "files"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_old"();
CREATE TRIGGER "context_pack_cache_symbols_ins" AFTER INSERT ON "symbols"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_new"();
CREATE TRIGGER "context_pack_cache_symbols_upd" AFTER UPDATE ON "symbols"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_new"();
CREATE TRIGGER "context_pack_cache_symbols_del" AFTER DELETE ON "symbols"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_old"();
CREATE TRIGGER "context_pack_cache_feature_files_ins" AFTER INSERT ON "feature_files"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_new"();
CREATE TRIGGER "context_pack_cache_feature_files_upd" AFTER UPDATE ON "feature_files"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_new"();
CREATE TRIGGER "context_pack_cache_feature_files_del" AFTER DELETE ON "feature_files"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_old"();
CREATE TRIGGER "context_pack_cache_features_ins" AFTER INSERT ON "features"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_new"();
CREATE TRIGGER "context_pack_cache_features_upd" AFTER UPDATE ON "features"
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_new"();
CREATE TRIGGER "context_pack_cache_features_del" AFTER DELETE ON "features"
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION "context_pack_cache_clear_old"();
