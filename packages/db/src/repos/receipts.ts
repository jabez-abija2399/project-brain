import { desc, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type NewReceipt, type Receipt, receipts } from "../schema";

export const receiptsRepo = {
  async insert(
    db: BrainDb,
    projectId: string,
    data: Omit<NewReceipt, "projectId">,
  ): Promise<Receipt> {
    const [row] = await db
      .insert(receipts)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert receipts returned no row");
    return row;
  },

  async list(db: BrainDb, projectId: string, limit = 50): Promise<Receipt[]> {
    return db
      .select()
      .from(receipts)
      .where(eq(receipts.projectId, projectId))
      .orderBy(desc(receipts.createdAt))
      .limit(limit);
  },
};
