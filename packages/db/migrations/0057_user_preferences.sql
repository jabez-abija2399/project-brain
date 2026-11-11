-- Backlog (Phase 9b follow-up, 2026-11-11): the "How do you build?" answer kept per account, so it follows the owner to
-- every browser (it was a browser cookie only). Additive only: one new table. Optional (the cookie is used before it).

CREATE TABLE "user_preferences" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "build_style" text,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
