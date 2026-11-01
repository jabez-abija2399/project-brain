import { deleteAccount } from "@/server/account";
import { requireUser } from "@/server/auth";
import { readJsonCapped } from "@/server/body";
import { getDb } from "@/server/db";
import { toResponse } from "@/server/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deletes the signed-in user's account and everything in it, once they typed their account name. Irreversible.
export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req, { allowSuspended: true });
    const result = await deleteAccount(getDb(), user, await readJsonCapped(req, 4096));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toResponse(err);
  }
}
