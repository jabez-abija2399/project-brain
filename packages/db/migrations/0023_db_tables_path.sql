-- FEAT-015: the CLI uploads RLS flags read from supabase/migrations (flags only, AC-005-05). Migration .sql files are
-- not indexed code files, so a table keeps its migration path instead of a files row (file_id becomes optional).
ALTER TABLE "db_tables" ALTER COLUMN "file_id" DROP NOT NULL;
ALTER TABLE "db_tables" ADD COLUMN "path" text NOT NULL DEFAULT '';
