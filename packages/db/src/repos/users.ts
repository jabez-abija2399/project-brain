import { and, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type NewUser, type User, accounts, users } from "../schema";

export const usersRepo = {
  async upsertById(db: BrainDb, data: NewUser): Promise<User> {
    const [row] = await db
      .insert(users)
      .values(data)
      .onConflictDoUpdate({ target: users.id, set: { name: data.name, email: data.email } })
      .returning();
    if (!row) throw new Error("upsert user returned no row");
    return row;
  },

  async getById(db: BrainDb, id: string): Promise<User | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  },

  /** The id of the user's GitHub sign-in account row (better-auth's account id), or null. */
  async githubAccountId(db: BrainDb, userId: string): Promise<string | null> {
    const rows = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "github")))
      .limit(1);
    return rows[0]?.id ?? null;
  },
};
