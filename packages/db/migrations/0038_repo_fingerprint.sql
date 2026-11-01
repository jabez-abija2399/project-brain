-- Real-test bug J (2026-11-01): two repositories ended up in one project. The project remembers which repository it
-- belongs to, as "r=<hash>;o=<hash>" (hashes of the root commit and the normalized remote, never the values). NULL until
-- the first upload that sends one; uploads from a different repository are refused.
ALTER TABLE "projects" ADD COLUMN "repo_fingerprint" text;
