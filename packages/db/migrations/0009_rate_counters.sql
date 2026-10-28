-- KI-023 (D-010): rate limits and the daily AI budget count in Postgres, so every server instance shares them.
-- key = what is counted (e.g. 'index:<token id>', 'ai:<project id>'; ids only, never a token), window_start = the
-- start of the minute or UTC day the count belongs to. Rows of past windows are pruned.
CREATE TABLE "rate_counters" (
  "key" text NOT NULL,
  "window_start" timestamptz NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("key", "window_start")
);
CREATE INDEX "rate_counters_window_idx" ON "rate_counters" ("window_start");
