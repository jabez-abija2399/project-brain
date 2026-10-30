-- Launch: `npx codeceipt` device approval. The CLI holds a secret device code (stored here only as a sha256 hash) and
-- shows a short user code; the signed-in owner approves that code for a project in the browser, and the CLI's next
-- poll receives a new project token (minted then, so no raw token is ever stored). Codes expire after 10 minutes and
-- are single use (status 'used').
CREATE TABLE "device_codes" (
  "id" text PRIMARY KEY,
  "device_code_hash" text NOT NULL UNIQUE,
  "user_code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  -- The repo folder name the CLI suggested for a new project (shown, never trusted as anything else).
  "suggested_name" text,
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
  "project_id" text REFERENCES "projects"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "last_polled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "device_codes_status_check" CHECK ("status" IN ('pending', 'approved', 'denied', 'used'))
);
CREATE UNIQUE INDEX "device_codes_pending_user_code_uniq" ON "device_codes" ("user_code") WHERE "status" = 'pending';
CREATE INDEX "device_codes_expires_idx" ON "device_codes" ("expires_at");
