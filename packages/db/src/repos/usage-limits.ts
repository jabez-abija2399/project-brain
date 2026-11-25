import { eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { BrainDb } from "../db";
import { usageLimits, users } from "../schema";

// FEAT-041: the default beta limits and per-user limits (migration 0058). A null limit means no limit. Callers are
// the server's limits module (reads) and the admin-only limits action (writes); both check the migration first.
export type Limits = { projects: number | null; judgedPerMonth: number | null };
export type UserLimitsRow = Limits & {
  userId: string;
  name: string;
  email: string;
  updatedBy: string;
  updatedAt: Date;
};

const DEFAULT_ID = "default";
const userRowId = (userId: string) => `user:${userId}`;

export const usageLimitsRepo = {
  /** The default row and the user's own row (either may be missing). */
  async forUser(
    db: BrainDb,
    userId: string,
  ): Promise<{ own: Limits | null; fallback: Limits | null }> {
    const rows = await db
      .select({
        id: usageLimits.id,
        projects: usageLimits.projects,
        judgedPerMonth: usageLimits.judgedPerMonth,
      })
      .from(usageLimits)
      .where(inArray(usageLimits.id, [userRowId(userId), DEFAULT_ID]));
    const pick = (id: string) => {
      const r = rows.find((x) => x.id === id);
      return r ? { projects: r.projects, judgedPerMonth: r.judgedPerMonth } : null;
    };
    return { own: pick(userRowId(userId)), fallback: pick(DEFAULT_ID) };
  },

  async getDefault(db: BrainDb): Promise<Limits | null> {
    const [r] = await db
      .select({ projects: usageLimits.projects, judgedPerMonth: usageLimits.judgedPerMonth })
      .from(usageLimits)
      .where(eq(usageLimits.id, DEFAULT_ID))
      .limit(1);
    return r ?? null;
  },

  async getForUser(db: BrainDb, userId: string): Promise<Limits | null> {
    const [r] = await db
      .select({ projects: usageLimits.projects, judgedPerMonth: usageLimits.judgedPerMonth })
      .from(usageLimits)
      .where(eq(usageLimits.id, userRowId(userId)))
      .limit(1);
    return r ?? null;
  },

  async setDefault(db: BrainDb, limits: Limits, updatedBy: string): Promise<void> {
    await db
      .insert(usageLimits)
      .values({ id: DEFAULT_ID, userId: null, ...limits, updatedBy })
      .onConflictDoUpdate({
        target: usageLimits.id,
        set: { ...limits, updatedBy, updatedAt: new Date() },
      });
  },

  async setForUser(db: BrainDb, userId: string, limits: Limits, updatedBy: string): Promise<void> {
    await db
      .insert(usageLimits)
      .values({ id: userRowId(userId), userId, ...limits, updatedBy })
      .onConflictDoUpdate({
        target: usageLimits.id,
        set: { ...limits, updatedBy, updatedAt: new Date() },
      });
  },

  /** Removes a user's own limits (they get the default again); false when they had none. */
  async clearForUser(db: BrainDb, userId: string): Promise<boolean> {
    const gone = await db
      .delete(usageLimits)
      .where(eq(usageLimits.id, userRowId(userId)))
      .returning({ id: usageLimits.id });
    return gone.length > 0;
  },

  /** Users with their own limits, newest change first. */
  async listUserLimits(db: BrainDb, limit = 200): Promise<UserLimitsRow[]> {
    return db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        projects: usageLimits.projects,
        judgedPerMonth: usageLimits.judgedPerMonth,
        updatedBy: usageLimits.updatedBy,
        updatedAt: usageLimits.updatedAt,
      })
      .from(usageLimits)
      .innerJoin(users, eq(users.id, usageLimits.userId))
      .where(isNotNull(usageLimits.userId))
      .orderBy(usageLimits.updatedAt)
      .limit(Math.min(Math.max(1, limit), 500));
  },

  /** A user id by exact email (case-insensitive), for the admin form; null when nobody has it. */
  async userIdByEmail(db: BrainDb, email: string): Promise<string | null> {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
      .limit(1);
    return row?.id ?? null;
  },
};
