-- Requests tied to the agent session they were made in (captured by the prompt-submit hook), so a session's receipt
-- checks only that session's requests. Older requests and those an agent recorded itself have no session (NULL).
ALTER TABLE "requests" ADD COLUMN "session_id" text;
CREATE INDEX "requests_project_session_idx" ON "requests" ("project_id", "session_id");
