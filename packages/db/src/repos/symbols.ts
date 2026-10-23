import { and, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type NewSymbol, type Symbol as SymbolRow, symbols } from "../schema";

export const symbolsRepo = {
  async insert(
    db: BrainDb,
    projectId: string,
    data: Omit<NewSymbol, "projectId">,
  ): Promise<SymbolRow> {
    const [row] = await db
      .insert(symbols)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert symbols returned no row");
    return row;
  },

  async list(
    db: BrainDb,
    projectId: string,
    filter: { kind?: string; name?: string } = {},
  ): Promise<SymbolRow[]> {
    const conditions = [eq(symbols.projectId, projectId)];
    if (filter.kind) conditions.push(eq(symbols.kind, filter.kind));
    if (filter.name) conditions.push(eq(symbols.name, filter.name));
    return db
      .select()
      .from(symbols)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions));
  },

  async deleteByFile(db: BrainDb, projectId: string, fileId: string): Promise<void> {
    await db
      .delete(symbols)
      .where(and(eq(symbols.projectId, projectId), eq(symbols.fileId, fileId)));
  },
};
