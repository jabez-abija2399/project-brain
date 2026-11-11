import { eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { userPreferences } from "../schema";

// Backlog: per-account preferences (migration 0057). Callers check the migration and pass the signed-in user's id.
export const userPreferencesRepo = {
  async buildStyle(db: BrainDb, userId: string): Promise<string | null> {
    const [row] = await db
      .select({ style: userPreferences.buildStyle })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    return row?.style ?? null;
  },

  async setBuildStyle(db: BrainDb, userId: string, style: string): Promise<void> {
    await db
      .insert(userPreferences)
      .values({ userId, buildStyle: style })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { buildStyle: style, updatedAt: new Date() },
      });
  },
};
