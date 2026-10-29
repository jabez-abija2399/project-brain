import { and, eq, inArray, sql } from "drizzle-orm";
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

  // Fail closed (build checklist rule 2): every table of the project becomes RLS unknown, never enabled. Used when
  // migrations changed but could not be re-read (FEAT-009 push while KI-014 keeps the sandbox out of the job).
  async markAllRlsUnknown(db: BrainDb, projectId: string): Promise<number> {
    const rows = await db
      .update(dbTables)
      .set({ rlsEnabled: false, rlsUnknown: true })
      .where(eq(dbTables.projectId, projectId))
      .returning({ id: dbTables.id });
    return rows.length;
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

  async byName(
    db: BrainDb,
    projectId: string,
    name: string,
    schema = "public",
  ): Promise<DbTable | null> {
    const rows = await db
      .select()
      .from(dbTables)
      .where(
        and(
          eq(dbTables.projectId, projectId),
          eq(dbTables.schema, schema),
          eq(dbTables.name, name),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },
};

export type TableFlagsRow = {
  schema: string;
  name: string;
  path: string;
  rlsEnabled: boolean;
  rlsUnknown: boolean;
};
export type PolicyFlagsRow = {
  schema: string;
  table: string;
  command: string;
  permissive: boolean;
  allowsAll: boolean;
  checksOwnership: boolean;
};
const CHUNK = 1000;

export const dbSchemaRepo = {
  /**
   * FEAT-015: replaces the project's tables and policies with the flags of the latest index, in one transaction under
   * a per-project lock (two uploads at once cannot leave duplicates). A policy whose table is not in the upload is
   * dropped. Returns the stored counts.
   */
  async replaceForProject(
    db: BrainDb,
    projectId: string,
    tables: TableFlagsRow[],
    policies: PolicyFlagsRow[],
  ): Promise<{ tables: number; policies: number }> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`supabase:${projectId}`}, 0))`,
      );
      await tx.delete(dbTables).where(eq(dbTables.projectId, projectId));
      const ids = new Map<string, string>();
      for (let i = 0; i < tables.length; i += CHUNK) {
        const rows = await tx
          .insert(dbTables)
          .values(tables.slice(i, i + CHUNK).map((t) => ({ ...t, projectId, fileId: null })))
          .returning({ id: dbTables.id, schema: dbTables.schema, name: dbTables.name });
        for (const r of rows) ids.set(`${r.schema}.${r.name}`, r.id);
      }
      const values = policies.flatMap((p) => {
        const tableId = ids.get(`${p.schema}.${p.table}`);
        return tableId
          ? [
              {
                tableId,
                command: p.command,
                permissive: p.permissive,
                allowsAll: p.allowsAll,
                checksOwnership: p.checksOwnership,
              },
            ]
          : [];
      });
      for (let i = 0; i < values.length; i += CHUNK) {
        await tx.insert(dbPolicies).values(values.slice(i, i + CHUNK));
      }
      return { tables: ids.size, policies: values.length };
    });
  },

  /** Every table of the project with its policies' flags (two queries). */
  async listWithPolicies(
    db: BrainDb,
    projectId: string,
  ): Promise<(DbTable & { policies: DbPolicy[] })[]> {
    const tables = await db
      .select()
      .from(dbTables)
      .where(eq(dbTables.projectId, projectId))
      .orderBy(dbTables.schema, dbTables.name, dbTables.id);
    if (tables.length === 0) return [];
    const policies = await db
      .select({ policy: dbPolicies })
      .from(dbPolicies)
      .innerJoin(dbTables, eq(dbPolicies.tableId, dbTables.id))
      .where(
        and(
          eq(dbTables.projectId, projectId),
          inArray(
            dbPolicies.tableId,
            tables.map((t) => t.id),
          ),
        ),
      );
    const byTable = new Map<string, DbPolicy[]>();
    for (const { policy } of policies) {
      byTable.set(policy.tableId, [...(byTable.get(policy.tableId) ?? []), policy]);
    }
    return tables.map((t) => ({ ...t, policies: byTable.get(t.id) ?? [] }));
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
