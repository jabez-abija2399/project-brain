import { BETA } from "@brain/core";
import { type BrainDb, type Limits, usageLimitsRepo } from "@brain/db";
import { missingMigrations } from "./migration-check";

// FEAT-041 (owner, 2026-11-25): flexible beta limits. A user's own limits (set by an admin) win over the default
// limits (also set by an admin), which win over the built-in ones (BETA). A null limit means no limit. Before
// migration 0058 is applied, or if reading fails, the built-in limits apply: the check never fails open.
export const USAGE_LIMITS_MIGRATION = "0058_usage_limits";
export const BUILT_IN: Limits = { projects: BETA.projects, judgedPerMonth: BETA.judgedPerMonth };

export async function limitsReady(db: BrainDb): Promise<boolean> {
  try {
    return !(await missingMigrations(db)).includes(USAGE_LIMITS_MIGRATION);
  } catch {
    return false;
  }
}

export type EffectiveLimits = Limits & { source: "user" | "default" | "built-in" };

/** The limits that apply to one user now. */
export async function effectiveLimits(db: BrainDb, userId: string): Promise<EffectiveLimits> {
  if (!(await limitsReady(db))) return { ...BUILT_IN, source: "built-in" };
  try {
    const { own, fallback } = await usageLimitsRepo.forUser(db, userId);
    if (own) return { ...own, source: "user" };
    if (fallback) return { ...fallback, source: "default" };
  } catch {
    // Reading failed: the built-in limits, never "no limit".
  }
  return { ...BUILT_IN, source: "built-in" };
}

/** The default limits everyone without their own gets (built-in until an admin sets them). */
export async function defaultLimits(db: BrainDb): Promise<Limits> {
  if (!(await limitsReady(db))) return BUILT_IN;
  try {
    return (await usageLimitsRepo.getDefault(db)) ?? BUILT_IN;
  } catch {
    return BUILT_IN;
  }
}

/** "3 projects" / "no limit on projects", for messages. */
export function limitWords(n: number | null, one: string, many: string): string {
  return n === null ? `no limit on ${many}` : `${n} ${n === 1 ? one : many}`;
}
