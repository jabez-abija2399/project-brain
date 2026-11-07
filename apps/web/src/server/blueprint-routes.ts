import type { BrainDb } from "@brain/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { type SessionUser, requireProjectAccess, requireUser } from "./auth";
import { getDb } from "./db";
import { toResponse } from "./errors";
import { parseInput } from "./validate";

// Roadmap Phase 3b: the Blueprint's owner routes share one shape. Session auth only (a project token gets 401, so
// agents never reach them); access first, so a stranger gets the same 404 whatever the body says; the body is read
// through the capped reader and validated again by the service.

type Ctx = { params: Promise<{ id: string }> };
type Handler<T> = (db: BrainDb, user: SessionUser, projectId: string, body: T) => Promise<unknown>;

const BODY_LIMIT = 64 * 1024;

export function ownerRoute(handler: Handler<unknown>, opts: { body: boolean }) {
  return async (req: Request, { params }: Ctx) => {
    try {
      const user = await requireUser(req);
      const { id } = await params;
      await requireProjectAccess(getDb(), id, user);
      const body = opts.body ? await parseInput(req, z.unknown(), BODY_LIMIT) : undefined;
      return NextResponse.json(await handler(getDb(), user, id, body));
    } catch (err) {
      return toResponse(err);
    }
  };
}
