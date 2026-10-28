import { diffFiles, diffSchema, parseIndexBody } from "@/server/code-index";
import { indexRoute } from "@/server/index-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CLI index step 1: which of these paths are new or have a different hash than the stored index.
export const POST = indexRoute("index.diff", async (db, projectId, req) => {
  const input = await parseIndexBody(req, diffSchema);
  return { changed: await diffFiles(db, projectId, input) };
});
