import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../db";
import { createTestDb } from "../testing";
import { dbPoliciesRepo, dbTablesRepo, filesRepo, projectsRepo, usersRepo } from "./index";

type Ctx = {
  pg: Awaited<ReturnType<typeof createTestDb>>;
  db: ReturnType<typeof fromPglite>;
};

async function setup(): Promise<Ctx> {
  const pg = await createTestDb();
  const db = fromPglite(pg);
  return { pg, db };
}

const SENTINEL = "auth.uid() = profiles.id AND org_id = current_org()";

describe("@brain/db db_tables / db_policies", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.pg.close();
  });

  it("AC-005-05 saves tables and policies as flags only, never the SQL expression text", async () => {
    const { pg, db } = ctx;
    await usersRepo.upsertById(db, { id: "u1", name: "U", email: "u@example.com" });
    const project = await projectsRepo.create(db, "u1", { name: "P" });
    const file = await filesRepo.insert(db, project.id, {
      path: "supabase/migrations/0001.sql",
      hash: "h1",
    });

    const table = await dbTablesRepo.insert(db, project.id, {
      fileId: file.id,
      name: "profiles",
      rlsEnabled: true,
    });
    expect(table.rlsEnabled).toBe(true);

    await dbPoliciesRepo.insert(db, project.id, {
      tableId: table.id,
      command: "SELECT",
      allowsAll: false,
      checksOwnership: true,
    });
    await dbPoliciesRepo.insert(db, project.id, {
      tableId: table.id,
      command: "ALL",
      allowsAll: true,
      checksOwnership: false,
    });

    const cols = await pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'db_tables'`,
    );
    const tableColumns = cols.rows.map((r) => r.column_name);
    expect(tableColumns.sort()).toEqual(
      ["file_id", "id", "name", "project_id", "rls_enabled", "rls_unknown", "schema"].sort(),
    );

    const polCols = await pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'db_policies'`,
    );
    const policyColumns = polCols.rows.map((r) => r.column_name);
    expect(policyColumns.sort()).toEqual(
      ["allows_all", "checks_ownership", "command", "id", "permissive", "table_id"].sort(),
    );
    for (const col of policyColumns) {
      const low = col.toLowerCase();
      expect(low).not.toContain("using");
      expect(low).not.toContain("with_check");
      expect(low).not.toContain("expr");
      expect(low).not.toMatch(/_(text|sql)$/);
    }

    const everyTableCol = await pg.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name ILIKE ANY (ARRAY['%using%', '%with_check%', '%expression%'])`,
    );
    expect(everyTableCol.rows.map((r) => r.table_name)).toEqual([]);

    const policies = await dbPoliciesRepo.listForTable(db, project.id, table.id);
    expect(policies).toHaveLength(2);
    for (const p of policies) {
      expect(JSON.stringify(p)).not.toContain(SENTINEL);
      expect(JSON.stringify(p)).not.toContain("auth.uid()");
      expect(JSON.stringify(p)).not.toContain("USING");
    }

    const dump = await pg.query<{ ok: number }>(
      `SELECT 1 AS ok FROM db_policies
          WHERE table_id::text ILIKE '%auth.uid%' OR command ILIKE '%(%'`,
    );
    expect(dump.rows).toEqual([]);
  });

  it("AC-005-05 AC-005-08 AC-005-09 stores schema, unknown RLS and permissive as flags; unknown is never enabled, restrictive never allows all", async () => {
    const { db } = ctx;
    await usersRepo.upsertById(db, { id: "u1", name: "U", email: "u@example.com" });
    const project = await projectsRepo.create(db, "u1", { name: "P" });
    const file = await filesRepo.insert(db, project.id, {
      path: "supabase/migrations/0001.sql",
      hash: "h1",
    });

    const priv = await dbTablesRepo.insert(db, project.id, {
      fileId: file.id,
      schema: "private",
      name: "profiles",
      rlsEnabled: false,
      rlsUnknown: true,
    });
    const pub = await dbTablesRepo.insert(db, project.id, { fileId: file.id, name: "profiles" });
    expect(pub.schema).toBe("public");
    expect(pub.rlsUnknown).toBe(false);
    expect((await dbTablesRepo.byName(db, project.id, "profiles"))?.id).toBe(pub.id);
    expect((await dbTablesRepo.byName(db, project.id, "profiles", "private"))?.id).toBe(priv.id);

    await expect(
      dbTablesRepo.insert(db, project.id, {
        fileId: file.id,
        name: "x",
        rlsEnabled: true,
        rlsUnknown: true,
      }),
    ).rejects.toThrow();

    const restrictive = await dbPoliciesRepo.insert(db, project.id, {
      tableId: pub.id,
      command: "UPDATE",
      permissive: false,
    });
    expect(restrictive.permissive).toBe(false);
    await expect(
      dbPoliciesRepo.insert(db, project.id, {
        tableId: pub.id,
        command: "UPDATE",
        permissive: false,
        allowsAll: true,
      }),
    ).rejects.toThrow();
  });
});
