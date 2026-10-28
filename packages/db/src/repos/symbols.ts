import { and, eq, ilike, or } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type NewSymbol, type Symbol as SymbolRow, files, symbols } from "../schema";

export type ComponentRow = {
  id: string;
  name: string;
  path: string;
  signature: string | null;
  summary: string | null;
  hash: string | null;
};

const INSERT_BATCH = 500;
const MAX_NAME_TOKENS = 20;

function likePattern(token: string): string {
  return `%${token.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

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

  async insertMany(
    db: BrainDb,
    projectId: string,
    rows: Omit<NewSymbol, "projectId">[],
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH).map((r) => ({ ...r, projectId }));
      await db.insert(symbols).values(batch);
    }
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

  // Components of one project with their file path: the candidate set for findSimilarComponent and the previous
  // hashes/summaries for a re-index. Bounded by the project's size (v1 budget: 2,000 files). nameContainsAny keeps
  // only names containing one of the tokens (case-insensitive), so the lookup reads candidates, not the whole set.
  async listComponents(
    db: BrainDb,
    projectId: string,
    filter: { nameContainsAny?: string[] } = {},
  ): Promise<ComponentRow[]> {
    const conditions = [eq(symbols.projectId, projectId), eq(symbols.kind, "component")];
    const tokens = filter.nameContainsAny?.slice(0, MAX_NAME_TOKENS);
    if (tokens) {
      if (tokens.length === 0) return [];
      const nameFilter = or(...tokens.map((t) => ilike(symbols.name, likePattern(t))));
      if (nameFilter) conditions.push(nameFilter);
    }
    return db
      .select({
        id: symbols.id,
        name: symbols.name,
        path: files.path,
        signature: symbols.signature,
        summary: symbols.summary,
        hash: symbols.hash,
      })
      .from(symbols)
      .innerJoin(files, and(eq(files.projectId, symbols.projectId), eq(files.id, symbols.fileId)))
      .where(and(...conditions));
  },

  async deleteByFile(db: BrainDb, projectId: string, fileId: string): Promise<void> {
    await db
      .delete(symbols)
      .where(and(eq(symbols.projectId, projectId), eq(symbols.fileId, fileId)));
  },
};
