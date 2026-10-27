import { requireProjectAccess, requireUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { AppError, toResponse } from "@/server/errors";
import { featureNameSchema, parseInput } from "@/server/validate";
import { FeatureNameTakenError, MAX_PAGE_SIZE, featuresRepo } from "@brain/db";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; fid: string }> };

// Rename the feature and/or move files (by file id) into it as their primary feature.
// Unknown keys are rejected (zod `strict`); project and feature ids come only from the URL.
const patchSchema = z
  .object({
    name: featureNameSchema.optional(),
    moveFiles: z.array(z.string().min(1).max(100)).min(1).max(MAX_PAGE_SIZE).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.moveFiles !== undefined, {
    message: "name or moveFiles is required",
  });

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser(req);
    const { id, fid } = await params;
    const db = getDb();
    const input = await parseInput(req, patchSchema);
    await requireProjectAccess(db, id, user);
    const feature = await featuresRepo.update(db, id, fid, {
      name: input.name,
      moveFileIds: input.moveFiles,
    });
    // A feature or file of another project is reported exactly like a missing one.
    if (!feature) throw new AppError(404, "not_found");
    return NextResponse.json({ ok: true, feature });
  } catch (err) {
    if (err instanceof FeatureNameTakenError) {
      return toResponse(new AppError(409, "feature_name_taken", err.message));
    }
    return toResponse(err);
  }
}
