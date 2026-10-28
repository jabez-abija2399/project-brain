-- FEAT-009 GitHub App. A project is linked to one repo of one App installation (installation_id + repo_full_name);
-- pushes to that repo re-index only that project. webhook_deliveries makes each delivery id count once (replay
-- protection); github_install_states holds the single-use state of an install flow (hash only, never the state).
ALTER TABLE "projects" ADD COLUMN "installation_id" bigint;
CREATE INDEX "projects_installation_repo_idx" ON "projects" ("installation_id", "repo_full_name");

CREATE TABLE "webhook_deliveries" (
  "delivery_id" text PRIMARY KEY NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "webhook_deliveries_received_idx" ON "webhook_deliveries" ("received_at");

CREATE TABLE "github_install_states" (
  "state_hash" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  -- Set once the callback proved the signed-in GitHub user can access this installation.
  "installation_id" bigint,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "github_install_states_expires_idx" ON "github_install_states" ("expires_at");
