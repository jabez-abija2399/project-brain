import { readJsonCapped } from "@/server/body";
import { indexRoute } from "@/server/index-route";
import { captureRequest } from "@/server/request-capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The prompt-submit hook records the user's request for the agent session. The project comes only from the URL,
// checked against the token (404 otherwise), with the CLI routes' rate limits; the body is capped.
export const POST = indexRoute("hooks.requests", async (db, projectId, req) =>
  captureRequest(db, projectId, await readJsonCapped(req, 32 * 1024)),
);
