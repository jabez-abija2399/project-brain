import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { revokeConnection } from "@/server/mcp-oauth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/account/oauth-connections/[id]: the signed-in owner revokes one of their own connections.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await revokeConnection(getDb(), req, id));
  } catch (err) {
    return toResponse(err);
  }
}
