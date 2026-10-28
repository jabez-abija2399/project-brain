import { summarizeDue } from "@/server/code-index";
import { indexRoute } from "@/server/index-route";
import { getLlm } from "@/server/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CLI index last step: summarize due components (bounded per request). Takes no input: the body is ignored and
// every timestamp comes from the server clock.
export const POST = indexRoute("index.summarize", (db, projectId) =>
  summarizeDue(db, projectId, getLlm()),
);
