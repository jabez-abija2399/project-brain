import { parseIndexBody } from "@/server/code-index";
import { indexRoute } from "@/server/index-route";
import { saveSupabaseFlags, supabaseFlagsSchema } from "@/server/supabase-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CLI index step (FEAT-015): RLS flags of the project's Supabase tables and policies, read locally from
// supabase/migrations. Flags only, never SQL; the project comes only from the URL, checked against the token.
export const POST = indexRoute("index.supabase", async (db, projectId, req) =>
  saveSupabaseFlags(db, projectId, await parseIndexBody(req, supabaseFlagsSchema)),
);
