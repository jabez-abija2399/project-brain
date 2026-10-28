-- FEAT-007 review M1: flags and timestamps only, no source code or prompt.
-- The outcome of the last summary attempt for the current symbols.hash, so an unchanged re-index does not send a
-- component again: 'ok', 'empty' (the model answered nothing) or 'error' (retried at most once per 24 h, 3 times per
-- hash). NULL = not attempted yet (also every row from before 0008).
ALTER TABLE "symbols"
  ADD COLUMN "summary_status" text,
  ADD COLUMN "summary_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN "summary_attempted_at" timestamptz,
  ADD CONSTRAINT "symbols_summary_status_check" CHECK ("summary_status" IN ('ok', 'empty', 'error'));
