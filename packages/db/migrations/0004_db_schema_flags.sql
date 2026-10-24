-- FEAT-005 review H1/M2 + unknown RLS: flags only (D-002), no SQL text.
-- db_tables: the Postgres schema of the table (public.profiles vs private.profiles) and whether its RLS state is
-- unknown (touched by a migration statement we could not read). Unknown is never reported as enabled.
ALTER TABLE "db_tables"
  ADD COLUMN "schema" text NOT NULL DEFAULT 'public',
  ADD COLUMN "rls_unknown" boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT "db_tables_unknown_not_enabled" CHECK (NOT ("rls_enabled" AND "rls_unknown"));

-- db_policies: AS PERMISSIVE (default) or AS RESTRICTIVE. A restrictive policy never allows everyone.
ALTER TABLE "db_policies"
  ADD COLUMN "permissive" boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT "db_policies_restrictive_not_allows_all" CHECK ("permissive" OR NOT "allows_all");
