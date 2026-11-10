import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATION_IDS, OPTIONAL_MIGRATIONS } from "./migration-check";
import { fromPglite } from "./pglite";
import { approvalAuditRepo, approvalRequestsRepo } from "./repos";
import { createTestDb } from "./testing";

// Roadmap Phase 6a, migration 0055: approval policies, requests and the append-only audit log.
let pg: PGlite;
beforeEach(async () => {
  pg = await createTestDb();
  await pg.exec(`INSERT INTO "user" ("id","name","email") VALUES ('u1','n','u1@example.com')`);
  await pg.exec(
    `INSERT INTO "projects" ("id","owner_id","name") VALUES ('p1','u1','A'),('p2','u1','B')`,
  );
});
afterEach(async () => {
  await pg.close();
});

const request = (projectId: string, expiresAt: Date) =>
  approvalRequestsRepo.insert(fromPglite(pg), projectId, {
    action: "delete_feature",
    risk: "high",
    feature: "Checkout",
    path: null,
    agent: "claude",
    summary: "Delete the old checkout feature",
    status: "pending",
    expiresAt,
  });

describe("migration 0055 (approvals)", () => {
  it("PH6-07 is registered after 0054 and optional", () => {
    expect(MIGRATION_IDS.indexOf("0055_approvals")).toBe(
      MIGRATION_IDS.indexOf("0054_blueprint") + 1,
    );
    expect(OPTIONAL_MIGRATIONS.has("0055_approvals")).toBe(true);
  });

  it("PH6-08 attack: the audit log is append-only; only deleting the project removes it", async () => {
    await approvalAuditRepo.append(fromPglite(pg), "p1", {
      event: "policy_changed",
      actorKind: "owner",
      actorId: "u1",
    });
    await expect(pg.exec(`UPDATE "approval_audit" SET "event" = 'nothing'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(pg.exec(`DELETE FROM "approval_audit"`)).rejects.toThrow(/append-only/);
    await pg.exec(`DELETE FROM "projects" WHERE "id" = 'p1'`);
    const r = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM "approval_audit"`);
    expect(r.rows[0]?.n).toBe(0);
  });

  it("PH6-09 a request is decided once, only while pending and unexpired, and only in its own project", async () => {
    const db = fromPglite(pg);
    const now = new Date("2026-11-10T12:00:00Z");
    const live = await request("p1", new Date("2026-11-11T12:00:00Z"));
    expect(await approvalRequestsRepo.decide(db, "p2", live.id, "approved", "u1", now)).toBeNull();
    expect(
      (await approvalRequestsRepo.decide(db, "p1", live.id, "approved", "u1", now))?.status,
    ).toBe("approved");
    expect(await approvalRequestsRepo.decide(db, "p1", live.id, "rejected", "u1", now)).toBeNull();
    const old = await request("p1", new Date("2026-11-09T12:00:00Z"));
    expect(await approvalRequestsRepo.decide(db, "p1", old.id, "approved", "u1", now)).toBeNull();
    expect(await approvalRequestsRepo.expire(db, "p1", now)).toEqual([{ id: old.id }]);
  });

  it("PH6-10 attack: oversized or unknown values are refused by the database itself", async () => {
    const bad = [
      `INSERT INTO "approval_policies" ("project_id","preset") VALUES ('p1','yolo')`,
      `INSERT INTO "approval_requests" ("id","project_id","action","risk","summary","status","expires_at") VALUES ('r1','p1','x','extreme','s','pending',now())`,
      `INSERT INTO "approval_requests" ("id","project_id","action","risk","summary","status","expires_at") VALUES ('r2','p1','x','low','${"s".repeat(301)}','pending',now())`,
      `INSERT INTO "approval_audit" ("id","project_id","event","actor_kind") VALUES ('a1','p1','e','admin')`,
    ];
    for (const sql of bad) await expect(pg.exec(sql), sql).rejects.toThrow();
  });
});
