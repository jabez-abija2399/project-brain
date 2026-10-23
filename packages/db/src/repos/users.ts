import { eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type NewUser, type User, users } from "../schema";

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
};
