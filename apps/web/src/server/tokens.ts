import { mergeFingerprints, parseFingerprintToken, sameRepo, tokenFromHashed } from "@brain/core";
import { projectTokensRepo, projectsRepo } from "@brain/db";
import type { BrainDb, ProjectToken } from "@brain/db";
import { AppError } from "./errors";
import { SUSPENDED_PROJECT, SUSPENDED_USER } from "./suspension";

export const REPO_HEADER = "x-codeceipt-repo";
const REPO_MISMATCH =
  "This repository is not the one this project was connected from; nothing was stored. Connect it to a new or existing project, or rebuild the index from the right repository.";

/**
 * Real-test bug J: the request's repository (the CLI's x-codeceipt-repo header, hashes only) against the project's.
 * A project adopts the first one it sees; a different one is refused (409) and nothing is stored. A request without the
 * header (an older CLI, MCP) is not checked. replace: `index --rebuild` makes the caller's repository the project's.
 */
export async function checkRepo(
  db: BrainDb,
  req: Request,
  projectId: string,
  opts: { replace?: boolean } = {},
): Promise<void> {
  const current = parseFingerprintToken(req.headers.get(REPO_HEADER));
  if (!current || (!current.root && !current.remote)) return;
  const result = await projectsRepo.updateRepoFingerprint(db, projectId, (raw) => {
    const stored = parseFingerprintToken(raw);
    if (!opts.replace && stored && !sameRepo(stored, current)) return "mismatch";
    return tokenFromHashed(opts.replace || !stored ? current : mergeFingerprints(stored, current));
  });
  if (result === "mismatch") throw new AppError(409, "repo_mismatch", REPO_MISMATCH);
}

export async function requireProjectToken(
  db: BrainDb,
  req: Request,
  opts: { replaceRepo?: boolean } = {},
): Promise<ProjectToken> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) throw new AppError(401, "unauthenticated");
  const row = await projectTokensRepo.findActiveByValue(db, match[1].trim());
  if (!row) throw new AppError(401, "unauthenticated");
  // A suspended project, or a project of a suspended user, gets one clear answer (CLI, hooks and MCP alike).
  const s = await projectsRepo.suspensionOf(db, row.projectId);
  if (s?.owner) throw new AppError(403, "suspended", SUSPENDED_USER);
  if (s?.project) throw new AppError(403, "suspended", SUSPENDED_PROJECT);
  await checkRepo(db, req, row.projectId, { replace: opts.replaceRepo });
  await projectTokensRepo.touchLastUsed(db, row.projectId, row.id).catch(() => {});
  return row;
}

// Token auth for a project in the URL: the token must belong to exactly that project. Another project's token
// gets 404, like a project that does not exist (never trust a project id from the client).
export async function requireTokenProject(
  db: BrainDb,
  req: Request,
  projectId: string,
  opts: { replaceRepo?: boolean } = {},
): Promise<ProjectToken> {
  const token = await requireProjectToken(db, req, opts);
  if (token.projectId !== projectId) throw new AppError(404, "not_found");
  return token;
}
