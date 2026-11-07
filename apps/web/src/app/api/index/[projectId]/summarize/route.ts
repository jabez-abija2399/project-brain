import { summarizeDue } from "@/server/code-index";
import { warmContextPacks } from "@/server/context-pack";
import { indexRoute } from "@/server/index-route";
import { getLlm } from "@/server/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CLI index last step: summarize due components (bounded per request). Takes no input: the body is ignored and
// every timestamp comes from the server clock.
export const POST = indexRoute("index.summarize", async (db, projectId) => {
  const result = await summarizeDue(db, projectId, getLlm());
  // New summaries cleared the cached context packs (0051 triggers); the last round builds them again.
  if (result.attempted > 0 && result.remaining === 0)
    await warmContextPacks(db, projectId).catch(() => 0);
  return result;
});
