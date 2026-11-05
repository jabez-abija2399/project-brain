-- FEAT-021 (2026-11-04): read-only links to one receipt. Additive only. Only a SHA-256 hash of the link's token is
-- stored, so the table never holds a working link. A revoked link stays revoked (revoked_at is never cleared).
CREATE TABLE "receipt_share_links" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "receipt_id" text NOT NULL REFERENCES "receipts"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz
);
CREATE UNIQUE INDEX "receipt_share_links_token_hash_uniq" ON "receipt_share_links" ("token_hash");
CREATE INDEX "receipt_share_links_project_idx" ON "receipt_share_links" ("project_id", "receipt_id");
