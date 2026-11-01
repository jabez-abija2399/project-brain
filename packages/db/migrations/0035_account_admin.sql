-- Account and admin (2026-11-01). Additive only.
-- Suspension: a suspended user or project cannot use the dashboard API, the CLI API or MCP (NULL = active).
ALTER TABLE "user" ADD COLUMN "suspendedAt" timestamptz;
ALTER TABLE "projects" ADD COLUMN "suspended_at" timestamptz;
-- Connected computers: what made the token ("salon-booking" from `npx codeceipt`, or the Tokens page). Never secret.
ALTER TABLE "project_tokens" ADD COLUMN "label" text;
-- AI calls per project per UTC day, kept for the admin AI usage page (rate counters are pruned after two days).
CREATE TABLE "ai_usage_daily" (
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "day" date NOT NULL,
  "calls" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("project_id", "day")
);
CREATE INDEX "ai_usage_daily_day_idx" ON "ai_usage_daily" ("day");
-- Admin audit log: who did what to which target, when. Ids are plain text (no foreign keys) so the record outlives a
-- deleted user or project. Rows can be added, never changed or removed.
CREATE TABLE "admin_audit" (
  "id" text PRIMARY KEY NOT NULL,
  "admin_user_id" text NOT NULL,
  "admin_login" text NOT NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "detail" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" ("created_at");
CREATE FUNCTION "admin_audit_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit is append-only';
END;
$$;
CREATE TRIGGER "admin_audit_no_change" BEFORE UPDATE OR DELETE ON "admin_audit"
  FOR EACH ROW EXECUTE FUNCTION "admin_audit_append_only"();
