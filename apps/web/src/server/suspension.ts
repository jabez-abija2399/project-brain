import { accountRepo } from "@brain/db";
import type { BrainDb } from "@brain/db";
import { AppError } from "./errors";

// Admin abuse control (2026-11-01): a suspended user or project gets one clear answer everywhere (dashboard API, CLI
// API, MCP), never a silent failure. 403 with code "suspended"; the CLI prints the message.
export const SUSPENDED_USER =
  "Your Codeceipt account is suspended. Contact support to restore it; until then the dashboard, CLI and MCP do not work.";
export const SUSPENDED_PROJECT =
  "This Codeceipt project is suspended. Contact support to restore it; until then its CLI and MCP access do not work.";

export async function assertNotSuspended(
  db: BrainDb,
  userId: string,
  projectId?: string,
): Promise<void> {
  const s = await accountRepo.suspension(db, userId, projectId ? [projectId] : []);
  if (s.user) throw new AppError(403, "suspended", SUSPENDED_USER);
  if (projectId && s.projects.includes(projectId))
    throw new AppError(403, "suspended", SUSPENDED_PROJECT);
}
