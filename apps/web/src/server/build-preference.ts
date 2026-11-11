import { BUILD_STYLES, type BuildStyle } from "@brain/core";
import { type BrainDb, userPreferencesRepo } from "@brain/db";
import type { SessionUser } from "./auth";
import { missingMigrations } from "./migration-check";

// Backlog (Phase 9b follow-up): the "How do you build?" answer kept per account once migration 0057 is in, so it
// follows the owner to every browser. A display preference only: it unlocks nothing. Before 0057 nothing is stored
// and the browser cookie is used, as before.
export const USER_PREFERENCES_MIGRATION = "0057_user_preferences";

const valid = (v: string | null | undefined): BuildStyle | null =>
  (BUILD_STYLES as readonly string[]).includes(v ?? "") ? (v as BuildStyle) : null;

async function ready(db: BrainDb): Promise<boolean> {
  return !(await missingMigrations(db)).includes(USER_PREFERENCES_MIGRATION);
}

/**
 * The answer to show: one picked now (?build=, then saved to the account), else this browser's cookie, else the
 * account's (so a new browser or computer gets it too). Never throws: a database problem falls back to the query and
 * the cookie.
 */
export async function buildPreference(
  db: BrainDb,
  user: SessionUser,
  picked: string | undefined,
  cookie: string | undefined,
): Promise<BuildStyle | null> {
  const now = valid(picked);
  const here = valid(cookie);
  try {
    if (await ready(db)) {
      if (now) {
        await userPreferencesRepo.setBuildStyle(db, user.id, now);
        return now;
      }
      if (here) return here;
      return valid(await userPreferencesRepo.buildStyle(db, user.id));
    }
  } catch {}
  return now ?? here;
}
