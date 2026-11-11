import { type BrainDb, projectSettingsRepo } from "@brain/db";
import { type SessionUser, requireProjectAccess } from "./auth";
import { AppError } from "./errors";
import { missingMigrations } from "./migration-check";

// Roadmap Phase 10b: per-project settings the owner turns on (migration 0056). Before that migration every setting
// reads as off and cannot be changed. Owner session only; a project token has no route to these.
export const PROJECT_SETTINGS_MIGRATION = "0056_project_settings";

export async function projectSettingsEnabled(db: BrainDb): Promise<boolean> {
  return !(await missingMigrations(db)).includes(PROJECT_SETTINGS_MIGRATION);
}

/** Whether receipts are posted on this project's pull requests. No access check: callers own the project id. */
export async function prReceiptsOn(db: BrainDb, projectId: string): Promise<boolean> {
  if (!(await projectSettingsEnabled(db))) return false;
  return projectSettingsRepo.prReceipts(db, projectId);
}

export async function projectSettingsView(db: BrainDb, user: SessionUser, projectId: string) {
  const project = await requireProjectAccess(db, projectId, user);
  const ready = await projectSettingsEnabled(db);
  return {
    ready,
    prReceipts: ready ? await projectSettingsRepo.prReceipts(db, project.id) : false,
    // Receipts can only be posted on a repository connected through the GitHub App.
    repoConnected: project.installationId !== null && project.repoFullName !== null,
  };
}

export async function setPrReceipts(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  body: unknown,
) {
  const project = await requireProjectAccess(db, projectId, user);
  const on = (body as { prReceipts?: unknown } | null)?.prReceipts;
  if (typeof on !== "boolean") {
    throw new AppError(400, "invalid_input", "send { prReceipts: true | false }");
  }
  if (!(await projectSettingsEnabled(db))) {
    throw new AppError(
      503,
      "settings_not_ready",
      "project settings are being set up; try again later",
    );
  }
  await projectSettingsRepo.setPrReceipts(db, project.id, on, user.id);
  console.info("[dashboard]", "pr_receipts", JSON.stringify({ projectId: project.id, on }));
  return { ok: true as const, prReceipts: on };
}
