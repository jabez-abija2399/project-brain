import { projectTokensRepo } from "@brain/db";
import type { BrainDb, ProjectToken } from "@brain/db";
import { AppError } from "./errors";

export async function requireProjectToken(db: BrainDb, req: Request): Promise<ProjectToken> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) throw new AppError(401, "unauthenticated");
  const row = await projectTokensRepo.findActiveByValue(db, match[1].trim());
  if (!row) throw new AppError(401, "unauthenticated");
  await projectTokensRepo.touchLastUsed(db, row.projectId, row.id).catch(() => {});
  return row;
}

// Token auth for a project in the URL: the token must belong to exactly that project. Another project's token
// gets 404, like a project that does not exist (never trust a project id from the client).
export async function requireTokenProject(
  db: BrainDb,
  req: Request,
  projectId: string,
): Promise<ProjectToken> {
  const token = await requireProjectToken(db, req);
  if (token.projectId !== projectId) throw new AppError(404, "not_found");
  return token;
}
