-- FEAT-007: hash of what a component summary is built from (path, name, signature; never source code).
-- A re-index regenerates the summary only when this hash changes. NULL for rows indexed before 0007.
ALTER TABLE "symbols" ADD COLUMN "hash" text;
