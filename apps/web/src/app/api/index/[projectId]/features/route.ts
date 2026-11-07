import { groupProject, parseIndexBody } from "@/server/code-index";
import { warmContextPacks } from "@/server/context-pack";
import { indexRoute } from "@/server/index-route";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CLI index step after the uploads: the server groups the project's stored files into features. Takes no input (an
// empty object; any key is a 400): the project comes only from the URL, checked against the token.
export const POST = indexRoute("index.features", async (db, projectId, req) => {
  await parseIndexBody(req, z.object({}).strict());
  const result = await groupProject(db, projectId);
  // Roadmap Phase 2a: build the likely-needed context packs now (bounded; never fails the index step).
  await warmContextPacks(db, projectId).catch(() => 0);
  return result;
});
