import { groupProject, parseIndexBody } from "@/server/code-index";
import { indexRoute } from "@/server/index-route";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CLI index step after the uploads: the server groups the project's stored files into features. Takes no input (an
// empty object; any key is a 400): the project comes only from the URL, checked against the token.
export const POST = indexRoute("index.features", async (db, projectId, req) => {
  await parseIndexBody(req, z.object({}).strict());
  return groupProject(db, projectId);
});
