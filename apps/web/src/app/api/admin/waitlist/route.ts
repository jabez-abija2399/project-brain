import { requireAdmin } from "@/server/admin";
import { waitlistCsv } from "@/server/admin-data";
import { getDb } from "@/server/db";
import { AppError, toResponse } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin: the waitlist as a CSV download (recorded in the audit log). Not an admin: 404.
export async function GET(req: Request) {
  try {
    // A GET that writes the audit log: only from the app's own pages (another site cannot start the download).
    const site = req.headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin" && site !== "none")
      throw new AppError(404, "not_found");
    const admin = await requireAdmin(req);
    const csv = await waitlistCsv(admin, getDb());
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="codeceipt-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return toResponse(err);
  }
}
