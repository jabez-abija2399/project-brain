-- MCP OAuth (2026-11-02): MCP clients without the CLI (Claude Desktop, claude.ai custom connectors, VS Code) connect to
-- /mcp by signing in. A grant is one signed-in owner's connection of one client to ONE of their projects. Only hashes
-- are stored: never a raw authorization code, access token or refresh token. Additive only.
CREATE TABLE "oauth_clients" (
  "id" text PRIMARY KEY NOT NULL,
  -- The client's own name (dynamic registration). Shown on the consent page, never trusted as an identity.
  "name" text NOT NULL,
  "redirect_uris" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE "oauth_grants" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "oauth_clients"("id") ON DELETE CASCADE,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  -- The resource (this server's /mcp URL) the grant was made for; a token is refused at any other resource.
  "resource" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_used_at" timestamptz,
  "revoked_at" timestamptz
);
CREATE INDEX "oauth_grants_user_idx" ON "oauth_grants" ("user_id");
CREATE INDEX "oauth_grants_project_idx" ON "oauth_grants" ("project_id");
-- Authorization codes: sha256 of the code, single use (used_at), 60 seconds (expires_at).
CREATE TABLE "oauth_codes" (
  "hash" text PRIMARY KEY NOT NULL,
  "grant_id" text NOT NULL REFERENCES "oauth_grants"("id") ON DELETE CASCADE,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz
);
-- Access tokens (1 hour) and refresh tokens (30 days), by sha256 hash. A rotated refresh token names its successor.
CREATE TABLE "oauth_tokens" (
  "hash" text PRIMARY KEY NOT NULL,
  "grant_id" text NOT NULL REFERENCES "oauth_grants"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "rotated_to" text,
  CONSTRAINT "oauth_tokens_kind_check" CHECK ("kind" IN ('access', 'refresh'))
);
CREATE INDEX "oauth_tokens_grant_idx" ON "oauth_tokens" ("grant_id");
