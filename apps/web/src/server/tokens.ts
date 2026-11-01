import { projectTokensRepo, projectsRepo } from "@brain/db";
import type { BrainDb, ProjectToken } from "@brain/db";
import { AppError } from "./errors";
import { SUSPENDED_PROJECT, SUSPENDED_USER } from "./suspension";

export async function requireProjectToken(db: BrainDb, req: Request): Promise<ProjectToken> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) throw new AppError(401, "unauthenticated");
  const row = await projectTokensRepo.findActiveByValue(db, match[1].trim());
  if (!row) throw new AppError(401, "unauthenticated");
  // A suspended project, or a project of a suspended user, gets one clear answer (CLI, hooks and MCP alike).
  const s = await projectsRepo.suspensionOf(db, row.projectId);
  if (s?.owner) throw new AppError(403, "suspended", SUSPENDED_USER);
  if (s?.project) throw new AppError(403, "suspended", SUSPENDED_PROJECT);
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
