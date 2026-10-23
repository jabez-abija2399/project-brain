import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../db";
import { createTestDb } from "../testing";
import {
  checklistItemsRepo,
  dbPoliciesRepo,
  dbTablesRepo,
  featureFilesRepo,
  featuresRepo,
  filesRepo,
  projectTokensRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
  symbolsRepo,
  usersRepo,
} from "./index";

// Drizzle wraps the driver error; Postgres code 23503 = foreign_key_violation.
const FK_VIOLATION = { cause: { code: "23503" } };

type Ctx = {
  pg: Awaited<ReturnType<typeof createTestDb>>;
  db: ReturnType<typeof fromPglite>;
};

async function setup(): Promise<Ctx> {
  const pg = await createTestDb();
  const db = fromPglite(pg);
  return { pg, db };
}

describe("@brain/db project-scoped repositories", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.pg.close();
  });

  it("AC-002-04 symbols.list for project A never returns rows from project B", async () => {
    const { db } = ctx;
    await usersRepo.upsertById(db, { id: "owner-a", name: "A", email: "a@example.com" });
    await usersRepo.upsertById(db, { id: "owner-b", name: "B", email: "b@example.com" });
    const projectA = await projectsRepo.create(db, "owner-a", { name: "Alpha" });
    const projectB = await projectsRepo.create(db, "owner-b", { name: "Beta" });

    const fileA = await filesRepo.insert(db, projectA.id, { path: "a.ts", hash: "ha" });
    const fileB = await filesRepo.insert(db, projectB.id, { path: "b.ts", hash: "hb" });

    await symbolsRepo.insert(db, projectA.id, {
      fileId: fileA.id,
      kind: "function",
      name: "secretA",
    });
    await symbolsRepo.insert(db, projectB.id, {
      fileId: fileB.id,
      kind: "function",
      name: "secretB",
    });

    const projectAView = await symbolsRepo.list(db, projectA.id);
    const projectBView = await symbolsRepo.list(db, projectB.id);
    expect(projectAView).toHaveLength(1);
    expect(projectAView[0]?.name).toBe("secretA");
    expect(projectBView).toHaveLength(1);
    expect(projectBView[0]?.name).toBe("secretB");

    const filteredCrossProject = await symbolsRepo.list(db, projectB.id, { name: "secretA" });
    expect(filteredCrossProject).toHaveLength(0);
  });

  it("AC-002-05 deleting a project cascades to files, symbols, features, agent_sessions, requests, receipts", async () => {
    const { pg, db } = ctx;
    await usersRepo.upsertById(db, { id: "owner-a", name: "A", email: "a@example.com" });
    await usersRepo.upsertById(db, { id: "owner-b", name: "B", email: "b@example.com" });
    const projectA = await projectsRepo.create(db, "owner-a", { name: "Alpha" });
    const projectB = await projectsRepo.create(db, "owner-b", { name: "Beta" });

    const fileA = await filesRepo.insert(db, projectA.id, { path: "a.ts", hash: "ha" });
    const fileB = await filesRepo.insert(db, projectB.id, { path: "b.ts", hash: "hb" });

    await symbolsRepo.insert(db, projectA.id, { fileId: fileA.id, kind: "function", name: "fnA" });
    await symbolsRepo.insert(db, projectB.id, { fileId: fileB.id, kind: "function", name: "fnB" });

    const featureA = await featuresRepo.insert(db, projectA.id, { name: "feat-A" });
    await featuresRepo.insert(db, projectB.id, { name: "feat-B" });

    const reqA = await requestsRepo.insert(db, projectA.id, {
      text: "req A",
      featureId: featureA.id,
    });
    await requestsRepo.insert(db, projectB.id, { text: "req B" });

    await receiptsRepo.insert(db, projectA.id, { requestId: reqA.id, summaryJson: { ok: true } });
    await receiptsRepo.insert(db, projectB.id, { summaryJson: { ok: true } });

    await pg.query(
      `INSERT INTO agent_sessions (id, project_id, goal) VALUES ('as-a', $1, 'goal A'), ('as-b', $2, 'goal B')`,
      [projectA.id, projectB.id],
    );

    await pg.query(
      `INSERT INTO decisions (id, project_id, title) VALUES ('d-a', $1, 'A'), ('d-b', $2, 'B')`,
      [projectA.id, projectB.id],
    );
    await featureFilesRepo.link(db, projectA.id, { featureId: featureA.id, fileId: fileA.id });
    await checklistItemsRepo.insert(db, projectA.id, { requestId: reqA.id, text: "A" });
    await projectTokensRepo.create(db, projectA.id);
    await projectTokensRepo.create(db, projectB.id);
    const tableA = await dbTablesRepo.insert(db, projectA.id, { fileId: fileA.id, name: "t" });
    await dbPoliciesRepo.insert(db, projectA.id, { tableId: tableA.id, command: "SELECT" });

    await projectsRepo.delete(db, projectA.id, "owner-a");

    const count = async (table: string) => {
      const r = await pg.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${table}" WHERE project_id = $1`,
        [projectA.id],
      );
      return r.rows[0]?.n ?? -1;
    };

    for (const table of [
      "projects",
      "files",
      "symbols",
      "features",
      "agent_sessions",
      "requests",
      "receipts",
      "decisions",
      "project_tokens",
      "db_tables",
    ]) {
      if (table === "projects") {
        const r = await pg.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM projects WHERE id = $1",
          [projectA.id],
        );
        expect(r.rows[0]?.n, "projects row for A should be gone").toBe(0);
      } else {
        expect(await count(table), `${table} should have 0 rows for project A`).toBe(0);
      }
    }

    for (const [table, column, id] of [
      ["feature_files", "feature_id", featureA.id],
      ["checklist_items", "request_id", reqA.id],
      ["db_policies", "table_id", tableA.id],
    ] as const) {
      const r = await pg.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "${table}" WHERE "${column}" = $1`,
        [id],
      );
      expect(r.rows[0]?.n, `${table} should have 0 rows for project A`).toBe(0);
    }

    const otherProjectRows = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM files WHERE project_id = $1",
      [projectB.id],
    );
    expect(otherProjectRows.rows[0]?.n).toBe(1);
  });

  it("AC-002-04 a row in project A cannot reference project B's file, feature or request", async () => {
    const { pg, db } = ctx;
    await usersRepo.upsertById(db, { id: "owner-a", name: "A", email: "a@example.com" });
    await usersRepo.upsertById(db, { id: "owner-b", name: "B", email: "b@example.com" });
    const projectA = await projectsRepo.create(db, "owner-a", { name: "Alpha" });
    const projectB = await projectsRepo.create(db, "owner-b", { name: "Beta" });
    const fileA = await filesRepo.insert(db, projectA.id, { path: "a.ts", hash: "ha" });
    const fileB = await filesRepo.insert(db, projectB.id, { path: "b.ts", hash: "hb" });
    const featureB = await featuresRepo.insert(db, projectB.id, { name: "feat-B" });
    const requestB = await requestsRepo.insert(db, projectB.id, { text: "req B" });

    await expect(
      symbolsRepo.insert(db, projectA.id, { fileId: fileB.id, kind: "function", name: "x" }),
    ).rejects.toMatchObject(FK_VIOLATION);
    await expect(
      dbTablesRepo.insert(db, projectA.id, { fileId: fileB.id, name: "t" }),
    ).rejects.toMatchObject(FK_VIOLATION);
    await expect(
      requestsRepo.insert(db, projectA.id, { text: "req A", featureId: featureB.id }),
    ).rejects.toMatchObject(FK_VIOLATION);
    await expect(
      receiptsRepo.insert(db, projectA.id, { requestId: requestB.id }),
    ).rejects.toMatchObject(FK_VIOLATION);

    // Same-project references still work, and deleting B never touches A's rows.
    await symbolsRepo.insert(db, projectA.id, { fileId: fileA.id, kind: "function", name: "a" });
    await dbTablesRepo.insert(db, projectA.id, { fileId: fileA.id, name: "t" });
    await projectsRepo.delete(db, projectB.id, "owner-b");
    expect(await symbolsRepo.list(db, projectA.id)).toHaveLength(1);
    expect(await dbTablesRepo.list(db, projectA.id)).toHaveLength(1);
    const left = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM files WHERE project_id = $1",
      [projectA.id],
    );
    expect(left.rows[0]?.n).toBe(1);
  });

  it("AC-002-04 feature_files and checklist_items cannot link rows of another project (KI-003)", async () => {
    const { pg, db } = ctx;
    await usersRepo.upsertById(db, { id: "owner-a", name: "A", email: "a@example.com" });
    await usersRepo.upsertById(db, { id: "owner-b", name: "B", email: "b@example.com" });
    const projectA = await projectsRepo.create(db, "owner-a", { name: "Alpha" });
    const projectB = await projectsRepo.create(db, "owner-b", { name: "Beta" });
    const fileA = await filesRepo.insert(db, projectA.id, { path: "a.ts", hash: "ha" });
    const fileB = await filesRepo.insert(db, projectB.id, { path: "b.ts", hash: "hb" });
    const featureA = await featuresRepo.insert(db, projectA.id, { name: "feat-A" });
    const featureB = await featuresRepo.insert(db, projectB.id, { name: "feat-B" });
    const requestA = await requestsRepo.insert(db, projectA.id, { text: "req A" });
    const requestB = await requestsRepo.insert(db, projectB.id, { text: "req B" });

    // The database itself refuses, whatever project_id the writer claims.
    const rawRejects = async (sql: string, params: string[]) => {
      await expect(pg.query(sql, params)).rejects.toMatchObject({ code: "23503" });
    };
    const linkSql =
      "INSERT INTO feature_files (project_id, feature_id, file_id) VALUES ($1, $2, $3)";
    await rawRejects(linkSql, [projectA.id, featureA.id, fileB.id]);
    await rawRejects(linkSql, [projectA.id, featureB.id, fileA.id]);
    await rawRejects(linkSql, [projectB.id, featureA.id, fileB.id]);
    const itemSql =
      "INSERT INTO checklist_items (id, project_id, request_id, text) VALUES ($1, $2, $3, 'x')";
    await rawRejects(itemSql, ["c-1", projectA.id, requestB.id]);
    await rawRejects(itemSql, ["c-2", projectB.id, requestA.id]);

    await expect(
      featureFilesRepo.link(db, projectA.id, { featureId: featureA.id, fileId: fileB.id }),
    ).rejects.toMatchObject(FK_VIOLATION);
    await expect(
      checklistItemsRepo.insert(db, projectA.id, { requestId: requestB.id, text: "x" }),
    ).rejects.toMatchObject(FK_VIOLATION);

    // Same-project links work and are only visible to their own project.
    await featureFilesRepo.link(db, projectA.id, { featureId: featureA.id, fileId: fileA.id });
    await checklistItemsRepo.insert(db, projectA.id, { requestId: requestA.id, text: "A" });
    expect(await featureFilesRepo.listForFeature(db, projectA.id, featureA.id)).toHaveLength(1);
    expect(await featureFilesRepo.listForFeature(db, projectB.id, featureA.id)).toEqual([]);
    expect(await checklistItemsRepo.listForRequest(db, projectA.id, requestA.id)).toHaveLength(1);
    expect(await checklistItemsRepo.listForRequest(db, projectB.id, requestA.id)).toEqual([]);
  });

  it("AC-002-04 db policy and token writes/reads are scoped by projectId", async () => {
    const { db } = ctx;
    await usersRepo.upsertById(db, { id: "owner-a", name: "A", email: "a@example.com" });
    await usersRepo.upsertById(db, { id: "owner-b", name: "B", email: "b@example.com" });
    const projectA = await projectsRepo.create(db, "owner-a", { name: "Alpha" });
    const projectB = await projectsRepo.create(db, "owner-b", { name: "Beta" });
    const fileA = await filesRepo.insert(db, projectA.id, { path: "a.sql", hash: "ha" });
    const tableA = await dbTablesRepo.insert(db, projectA.id, { fileId: fileA.id, name: "t" });

    await dbPoliciesRepo.insert(db, projectA.id, { tableId: tableA.id, command: "SELECT" });
    await expect(
      dbPoliciesRepo.insert(db, projectB.id, { tableId: tableA.id, command: "DELETE" }),
    ).rejects.toThrow(/not found/i);
    expect(await dbPoliciesRepo.listForTable(db, projectA.id, tableA.id)).toHaveLength(1);
    expect(await dbPoliciesRepo.listForTable(db, projectB.id, tableA.id)).toEqual([]);

    const { row: tokenA } = await projectTokensRepo.create(db, projectA.id);
    await projectTokensRepo.touchLastUsed(db, projectB.id, tokenA.id);
    expect((await projectTokensRepo.getById(db, projectA.id, tokenA.id))?.lastUsedAt).toBeNull();
    await projectTokensRepo.touchLastUsed(db, projectA.id, tokenA.id);
    expect(
      (await projectTokensRepo.getById(db, projectA.id, tokenA.id))?.lastUsedAt,
    ).toBeInstanceOf(Date);
  });
});
