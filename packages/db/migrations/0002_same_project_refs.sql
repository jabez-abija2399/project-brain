-- FEAT-002 fix: a row can only reference a file/feature/request of its own project.
-- The single-column FKs allowed project A's symbol to point at project B's file, so
-- deleting B silently deleted A's rows. Composite FKs on (project_id, <ref>) close that.

CREATE UNIQUE INDEX "files_project_id_uniq" ON "files" ("project_id", "id");
CREATE UNIQUE INDEX "features_project_id_uniq" ON "features" ("project_id", "id");
CREATE UNIQUE INDEX "requests_project_id_uniq" ON "requests" ("project_id", "id");

ALTER TABLE "symbols"
  DROP CONSTRAINT "symbols_file_id_fkey",
  ADD CONSTRAINT "symbols_file_same_project_fk"
  FOREIGN KEY ("project_id", "file_id") REFERENCES "files" ("project_id", "id") ON DELETE CASCADE;

ALTER TABLE "db_tables"
  DROP CONSTRAINT "db_tables_file_id_fkey",
  ADD CONSTRAINT "db_tables_file_same_project_fk"
  FOREIGN KEY ("project_id", "file_id") REFERENCES "files" ("project_id", "id") ON DELETE CASCADE;

-- SET NULL (col) keeps project_id intact when the referenced row goes (Postgres 15+).
ALTER TABLE "requests"
  DROP CONSTRAINT "requests_feature_id_fkey",
  ADD CONSTRAINT "requests_feature_same_project_fk"
  FOREIGN KEY ("project_id", "feature_id") REFERENCES "features" ("project_id", "id")
  ON DELETE SET NULL ("feature_id");

ALTER TABLE "receipts"
  DROP CONSTRAINT "receipts_request_id_fkey",
  ADD CONSTRAINT "receipts_request_same_project_fk"
  FOREIGN KEY ("project_id", "request_id") REFERENCES "requests" ("project_id", "id")
  ON DELETE SET NULL ("request_id");
