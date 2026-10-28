import { requireProjectAccess, requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { AppError, toResponse } from "@/server/errors";
import { featureNameSchema, parseInput } from "@/server/validate";
import { FeatureNameTakenError, MAX_FEATURES_PER_PROJECT, featuresRepo } from "@brain/db";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Create a feature by hand (to split an automatic one, then move files into it with PATCH). Only a name: the key
// stays NULL, so a re-index never matches or renames it; the project id comes only from the URL.
const createSchema = z.object({ name: featureNameSchema }).strict();

export async function POST(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const db = getDb();
    const input = await parseInput(req, createSchema);
    await requireProjectAccess(db, id, user);
    const feature = await featuresRepo.create(db, id, input.name);
    if (!feature)
      throw new AppError(
        409,
        "too_many_features",
        `a project can have at most ${MAX_FEATURES_PER_PROJECT} features`,
      );
    return NextResponse.json({ ok: true, feature }, { status: 201 });
  } catch (err) {
    if (err instanceof FeatureNameTakenError) {
      return toResponse(new AppError(409, "feature_name_taken", err.message));
    }
    return toResponse(err);
  }
}
