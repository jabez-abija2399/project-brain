import { exportAccount } from "@/server/account";
import { requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The signed-in user's data as a JSON download (never tokens or hashes; never cached).
export async function GET(req: Request) {
  try {
    const user = await requireUser(req, { allowSuspended: true });
    const data = await exportAccount(getDb(), user);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="codeceipt-export-${data.exportedAt.slice(0, 10)}.json"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return toResponse(err);
  }
}
