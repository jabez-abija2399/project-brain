import { indexRoute } from "@/server/index-route";
import { codeIndexRepo } from "@brain/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `codeceipt index --rebuild` (real-test bug J): clears the project's stored index (files, symbols, placements,
// Supabase tables, unused automatic features) and makes the calling repository the project's, so the index that
// follows comes from one repository only. Requests, receipts and named features are kept.
export const POST = indexRoute(
  "index.rebuild",
  async (db, projectId) => codeIndexRepo.clearForRebuild(db, projectId),
  {
    replaceRepo: true,
  },
);
