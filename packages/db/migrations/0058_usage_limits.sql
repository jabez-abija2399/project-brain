-- FEAT-041 (owner, 2026-11-25): flexible beta limits. One row "default" holds the limits for everyone; a row
-- "user:<id>" holds one user's own limits, which win over the default. A NULL limit means no limit. Additive only:
-- one new table. Optional: before it is applied the app uses the built-in limits (3 projects, 100 a month).

CREATE TABLE "usage_limits" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
  "projects" integer,
  "judged_per_month" integer,
  "updated_by" text NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "usage_limits_scope" CHECK (
    ("id" = 'default' AND "user_id" IS NULL) OR ("user_id" IS NOT NULL AND "id" = 'user:' || "user_id")
  ),
  CONSTRAINT "usage_limits_projects_range" CHECK ("projects" IS NULL OR ("projects" >= 0 AND "projects" <= 100000)),
  CONSTRAINT "usage_limits_judged_range" CHECK ("judged_per_month" IS NULL OR ("judged_per_month" >= 0 AND "judged_per_month" <= 1000000))
);
