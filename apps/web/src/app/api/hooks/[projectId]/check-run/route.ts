import { readJsonCapped } from "@/server/body";
import { recordCheckRun } from "@/server/check-run";
import { indexRoute } from "@/server/index-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// FEAT-022: the CLI posts the result of the repo's check command for one of this project's receipts. The project
// comes only from the URL, checked against the token (404 otherwise); the body is small and strictly shaped.
export const POST = indexRoute("hooks.check-run", async (db, projectId, req) =>
  recordCheckRun(db, projectId, await readJsonCapped(req, 2 * 1024)),
);
