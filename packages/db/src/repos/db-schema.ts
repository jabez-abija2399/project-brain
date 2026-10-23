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

  async byId(db: BrainDb, projectId: string, id: string): Promise<DbTable | null> {
    const rows = await db
      .select()
      .from(dbTables)
      .where(and(eq(dbTables.projectId, projectId), eq(dbTables.id, id)))
      .limit(1);
    return rows[0] ?? null;
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
  async insert(db: BrainDb, projectId: string, data: NewDbPolicy): Promise<DbPolicy> {
    // db_policies has no project_id; the parent table must belong to the project.
    const table = await dbTablesRepo.byId(db, projectId, data.tableId);
    if (!table) throw new Error("db_tables row not found in this project");
    const [row] = await db.insert(dbPolicies).values(data).returning();
    if (!row) throw new Error("insert db_policies returned no row");
    return row;
  },

  async listForTable(db: BrainDb, projectId: string, tableId: string): Promise<DbPolicy[]> {
    const rows = await db
      .select({ policy: dbPolicies })
      .from(dbPolicies)
      .innerJoin(dbTables, eq(dbPolicies.tableId, dbTables.id))
      .where(and(eq(dbTables.projectId, projectId), eq(dbPolicies.tableId, tableId)));
    return rows.map((r) => r.policy);
  },
};
