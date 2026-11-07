-- Roadmap Phase 2a (2026-11-07): a per-feature cache of a context pack's FILES and COMPONENTS lines, so
-- get_context_pack is one row read instead of three queries in a row. Paths, names and short summaries only (never
-- source code). Additive only: one table, one function, triggers.
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
-- pack can never be older than the index. The next read rebuilds the entry.
CREATE FUNCTION "context_pack_cache_clear"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "context_pack_cache"
  WHERE "project_id" = COALESCE(NEW."project_id", OLD."project_id");
  RETURN NULL;
END;
$$;
CREATE TRIGGER "context_pack_cache_files" AFTER INSERT OR UPDATE OR DELETE ON "files"
  FOR EACH ROW EXECUTE FUNCTION "context_pack_cache_clear"();
CREATE TRIGGER "context_pack_cache_symbols" AFTER INSERT OR UPDATE OR DELETE ON "symbols"
  FOR EACH ROW EXECUTE FUNCTION "context_pack_cache_clear"();
CREATE TRIGGER "context_pack_cache_feature_files" AFTER INSERT OR UPDATE OR DELETE ON "feature_files"
  FOR EACH ROW EXECUTE FUNCTION "context_pack_cache_clear"();
CREATE TRIGGER "context_pack_cache_features" AFTER INSERT OR UPDATE OR DELETE ON "features"
  FOR EACH ROW EXECUTE FUNCTION "context_pack_cache_clear"();
