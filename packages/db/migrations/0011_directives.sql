-- FEAT-010: standing instructions an agent proposes through MCP. A directive is a 'proposal' until the project
-- owner confirms it in the dashboard ('active'); only active directives reach where_did_we_stop. created_by is
-- the actor that saved it ('agent' for MCP tokens); confirmed_at is set by the server clock.
CREATE TABLE "directives" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "status" text NOT NULL DEFAULT 'proposal' CHECK ("status" IN ('proposal', 'active', 'dismissed')),
  "created_by" text NOT NULL CHECK ("created_by" IN ('agent', 'owner')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "confirmed_at" timestamptz
);
CREATE INDEX "directives_project_status_idx" ON "directives" ("project_id", "status");
