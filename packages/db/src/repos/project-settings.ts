import { eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { projectSettings } from "../schema";

// Roadmap Phase 10b: per-project settings (migration 0056). Callers check the migration and the owner's access first.
export const projectSettingsRepo = {
  /** Whether receipts are posted on this project's pull requests (off when there is no row). */
  async prReceipts(db: BrainDb, projectId: string): Promise<boolean> {
    const [row] = await db
      .select({ on: projectSettings.prReceipts })
      .from(projectSettings)
      .where(eq(projectSettings.projectId, projectId))
      .limit(1);
    return row?.on ?? false;
  },

  async setPrReceipts(db: BrainDb, projectId: string, on: boolean, userId: string): Promise<void> {
    await db
      .insert(projectSettings)
      .values({ projectId, prReceipts: on, updatedBy: userId })
      .onConflictDoUpdate({
        target: projectSettings.projectId,
        set: { prReceipts: on, updatedBy: userId, updatedAt: new Date() },
      });
  },
};
