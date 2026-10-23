import { and, eq } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type DbPolicy,
  type DbTable,
  type NewDbPolicy,
  type NewDbTable,
  dbPolicies,
  dbTables,
} from "../schema";

export const dbTablesRepo = {
  async insert(
    db: BrainDb,
    projectId: string,
    data: Omit<NewDbTable, "projectId">,
  ): Promise<DbTable> {
    const [row] = await db
      .insert(dbTables)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert db_tables returned no row");
    return row;
  },

  async list(db: BrainDb, projectId: string): Promise<DbTable[]> {
    return db.select().from(dbTables).where(eq(dbTables.projectId, projectId));
  },

  async byName(db: BrainDb, projectId: string, name: string): Promise<DbTable | null> {
    const rows = await db
      .select()
      .from(dbTables)
      .where(and(eq(dbTables.projectId, projectId), eq(dbTables.name, name)))
      .limit(1);
    return rows[0] ?? null;
  },
};

export const dbPoliciesRepo = {
  async insert(db: BrainDb, data: NewDbPolicy): Promise<DbPolicy> {
    const [row] = await db.insert(dbPolicies).values(data).returning();
    if (!row) throw new Error("insert db_policies returned no row");
    return row;
  },

  async listForTable(db: BrainDb, tableId: string): Promise<DbPolicy[]> {
    return db.select().from(dbPolicies).where(eq(dbPolicies.tableId, tableId));
  },
};
