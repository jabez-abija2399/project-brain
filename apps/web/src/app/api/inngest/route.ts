import { inngest } from "@/server/inngest";
import { indexPushFunction } from "@/server/inngest-functions";
import { serve } from "inngest/next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inngest calls this route to run the jobs; requests are signed with INNGEST_SIGNING_KEY (checked by serve).
export const { GET, POST, PUT } = serve({ client: inngest, functions: [indexPushFunction] });
