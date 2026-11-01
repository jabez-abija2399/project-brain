-- Real-test bug J (2026-11-01): two repositories ended up in one project. The project remembers which repository it
-- belongs to, as "r=<hash>;o=<hash>" (hashes of the root commit and the normalized remote, never the values). NULL until
-- the first upload that sends one; uploads from a different repository are refused.
ALTER TABLE "projects" ADD COLUMN "repo_fingerprint" text;

-- Real-test bugs G and H (2026-11-01): a checklist item the user deferred is "postponed" (recorded, never judged,
-- listed in the next start note), and an item a receipt found done without a test is "done_untested" (never done,
-- AC-013-07; kept out of the open work in the start note).
ALTER TABLE "checklist_items" DROP CONSTRAINT "checklist_items_status_check";
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_status_check"
  CHECK ("status" IN ('open', 'done', 'partial', 'missed', 'dismissed', 'postponed', 'done_untested'));
