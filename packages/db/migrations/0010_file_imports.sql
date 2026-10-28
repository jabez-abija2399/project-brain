-- FEAT-006 wire-in: the repo paths each file imports (resolved by the CLI; paths only, never source), so the server
-- can group the stored files into features. NULL for rows indexed before 0010: the diff reports them as changed.
ALTER TABLE "files" ADD COLUMN "imports" text[];
