import { diffFiles, diffSchema, parseIndexBody } from "@/server/code-index";
import { indexRoute } from "@/server/index-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CLI index step 1: which of these paths are new or have a different hash than the stored index, and (with a range,
// KI-024) which stored files in the range are gone locally; those are removed with their symbols.
export const POST = indexRoute("index.diff", async (db, projectId, req) =>
  diffFiles(db, projectId, await parseIndexBody(req, diffSchema)),
);
