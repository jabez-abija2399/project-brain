import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../db";
import { createTestDb } from "../testing";
import {
  featuresRepo,
  filesRepo,
  projectsRepo,
  receiptsRepo,
  requestsRepo,
  symbolsRepo,
} from "./index";

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

    const otherProjectRows = await pg.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM files WHERE project_id = $1",
      [projectB.id],
    );
    expect(otherProjectRows.rows[0]?.n).toBe(1);
  });
});
