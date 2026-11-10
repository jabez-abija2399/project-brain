-- Roadmap Phase 6a (2026-11-10): approval policies. The owner's policy per project (a preset and rules), the requests
-- agents make and how each was decided, and an append-only audit log of every policy change and decision. Additive
-- only: three new tables, one function and one trigger. Optional (the app answers "not set up yet" before it).

CREATE TABLE "approval_policies" (
  "project_id" text PRIMARY KEY NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "preset" text NOT NULL DEFAULT 'balanced',
  "rules" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "paused_until" timestamptz,
  "updated_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "approval_policies_preset_check" CHECK ("preset" IN ('careful', 'balanced', 'fast')),
  CONSTRAINT "approval_policies_rules_size_check" CHECK (octet_length("rules"::text) <= 65536)
);

CREATE TABLE "approval_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "risk" text NOT NULL,
  "feature" text,
  "path" text,
  "agent" text,
  "summary" text NOT NULL,
  "status" text NOT NULL,
  "decided_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "decided_at" timestamptz,
  "undone_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "approval_requests_risk_check" CHECK ("risk" IN ('low', 'medium', 'high', 'locked')),
  CONSTRAINT "approval_requests_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected', 'expired', 'auto', 'never')),
  CONSTRAINT "approval_requests_text_check" CHECK (
    char_length("summary") <= 300 AND char_length("action") <= 64
    AND coalesce(char_length("feature"), 0) <= 200 AND coalesce(char_length("path"), 0) <= 1024
    AND coalesce(char_length("agent"), 0) <= 40
  )
);
CREATE INDEX "approval_requests_project_status_idx" ON "approval_requests" ("project_id", "status", "created_at");

CREATE TABLE "approval_audit" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "event" text NOT NULL,
  "request_id" text,
  "actor_kind" text NOT NULL,
  "actor_id" text,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "approval_audit_actor_check" CHECK ("actor_kind" IN ('owner', 'agent', 'system')),
  CONSTRAINT "approval_audit_detail_size_check" CHECK (octet_length("detail"::text) <= 8192)
);
CREATE INDEX "approval_audit_project_idx" ON "approval_audit" ("project_id", "created_at");
-- Append-only: no update, and no delete except when the project itself is gone (its ON DELETE CASCADE still works).
CREATE FUNCTION "approval_audit_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM "projects" WHERE "id" = OLD."project_id") THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'approval_audit rows are append-only';
END;
$$;
CREATE TRIGGER "approval_audit_no_change" BEFORE UPDATE OR DELETE ON "approval_audit"
  FOR EACH ROW EXECUTE FUNCTION "approval_audit_append_only"();
-- TRUNCATE skips row triggers, so it is refused by a statement trigger of its own.
CREATE TRIGGER "approval_audit_no_truncate" BEFORE TRUNCATE ON "approval_audit"
  FOR EACH STATEMENT EXECUTE FUNCTION "approval_audit_append_only"();
