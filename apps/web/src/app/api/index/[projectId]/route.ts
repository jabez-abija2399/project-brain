import { parseIndexBody, saveIndexBatch, uploadSchema } from "@/server/code-index";
import { indexRoute } from "@/server/index-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CLI index upload: one batch of file metadata (paths, hashes, symbol names and signatures; never source).
export const POST = indexRoute("index.upload", async (db, projectId, req) => {
  const input = await parseIndexBody(req, uploadSchema);
  await saveIndexBatch(db, projectId, input);
  return { files: input.files.length };
});
