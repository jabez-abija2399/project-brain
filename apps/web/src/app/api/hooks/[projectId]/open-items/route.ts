import { indexRoute } from "@/server/index-route";
import { openItems } from "@/server/open-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// FEAT-016 session-end hook: the newest requests with unresolved checklist items. The project comes only from the URL,
// checked against the token (404 otherwise); same per-token and per-project rate limits as the CLI's index routes.
export const GET = indexRoute("hooks.open-items", async (db, projectId, req) => {
  const params = new URL(req.url).searchParams;
  return openItems(db, projectId, { session: params.get("session"), since: params.get("since") });
});
