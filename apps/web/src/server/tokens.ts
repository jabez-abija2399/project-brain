import { projectTokensRepo } from "@brain/db";
import type { BrainDb, ProjectToken } from "@brain/db";
import { AppError } from "./errors";

export async function requireProjectToken(db: BrainDb, req: Request): Promise<ProjectToken> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) throw new AppError(401, "unauthenticated");
  const row = await projectTokensRepo.findActiveByValue(db, match[1].trim());
  if (!row) throw new AppError(401, "unauthenticated");
  // Fire-and-forget: last_used_at is nice-to-have, not critical.
  void projectTokensRepo.touchLastUsed(db, row.id).catch(() => {});
  return row;
}
