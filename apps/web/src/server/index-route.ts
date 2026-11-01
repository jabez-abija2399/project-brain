import type { BrainDb } from "@brain/db";
import { NextResponse } from "next/server";
import { INDEX_REQUESTS_PER_MINUTE } from "./code-index";
import { getDb } from "./db";
import { toResponse } from "./errors";
import { rateLimit } from "./rate-limit";
import { requireTokenProject } from "./tokens";

type Ctx = { params: Promise<{ projectId: string }> };

// Shared shell of the /api/index/:projectId routes: the token must belong to the URL's project (else 404), one rate
// limit per token and one per project, so extra tokens don't multiply it (Postgres counters shared by all
// instances), one log line (route, project, duration, outcome; never
// the body or the token), one error shape.
export function indexRoute(
  name: string,
  handle: (db: BrainDb, projectId: string, req: Request) => Promise<Record<string, unknown>>,
  opts: { replaceRepo?: boolean } = {},
) {
  return async (req: Request, { params }: Ctx): Promise<Response> => {
    const started = Date.now();
    const { projectId } = await params;
    let status = 200;
    try {
      const db = getDb();
      const token = await requireTokenProject(db, req, projectId, opts);
      await rateLimit(db, `index:${token.id}`, INDEX_REQUESTS_PER_MINUTE);
      await rateLimit(db, `index-project:${projectId}`, INDEX_REQUESTS_PER_MINUTE);
      return NextResponse.json({ ok: true, ...(await handle(db, projectId, req)) });
    } catch (err) {
      const res = toResponse(err);
      status = res.status;
      return res;
    } finally {
      console.info("[api]", name, JSON.stringify({ projectId, status, ms: Date.now() - started }));
    }
  };
}
