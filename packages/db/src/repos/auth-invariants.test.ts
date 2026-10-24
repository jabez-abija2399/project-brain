// FEAT-003 security pass (delta): schema invariants that back the sign-in flow.
// Written as DB-level assertions so a schema regression breaks the gate even
// if the API layer is bypassed.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../testing";

type Pg = Awaited<ReturnType<typeof createTestDb>>;

async function newUser(pg: Pg, id: string, email: string) {
  await pg.query(`INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)`, [
    id,
    `name-${id}`,
    email,
  ]);
}

describe("FEAT-003 schema invariants that back sign-in", () => {
  let pg: Pg;
  beforeEach(async () => {
    pg = await createTestDb();
  });
  afterEach(async () => {
    await pg.close();
  });

  it("AC-003-13 account(providerId, accountId) is UNIQUE: one GitHub account cannot be linked to two users", async () => {
    await newUser(pg, "user-1", "a@example.com");
    await newUser(pg, "user-2", "b@example.com");

    await pg.query(
      `INSERT INTO "account" (id, "userId", "accountId", "providerId")
       VALUES ('acc-1', 'user-1', 'github-42', 'github')`,
    );

    await expect(
      pg.query(
        `INSERT INTO "account" (id, "userId", "accountId", "providerId")
         VALUES ('acc-2', 'user-2', 'github-42', 'github')`,
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("user.email is UNIQUE: two sign-ups with the same email cannot both succeed", async () => {
    await newUser(pg, "user-1", "shared@example.com");
    await expect(newUser(pg, "user-2", "shared@example.com")).rejects.toThrow(/unique|duplicate/i);
  });

  it("AC-003-14 deleting a user cascades to sessions and accounts (no orphaned auth rows)", async () => {
    await newUser(pg, "doomed", "d@example.com");
    await pg.query(
      `INSERT INTO "session" (id, "userId", token, "expiresAt")
       VALUES ('s1', 'doomed', 'tok-1', now() + interval '1 hour')`,
    );
    await pg.query(
      `INSERT INTO "account" (id, "userId", "accountId", "providerId")
       VALUES ('a1', 'doomed', 'github-99', 'github')`,
    );

    await pg.query(`DELETE FROM "user" WHERE id = 'doomed'`);

    const sess = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "session" WHERE "userId" = 'doomed'`,
    );
    const acc = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "account" WHERE "userId" = 'doomed'`,
    );
    expect(sess.rows[0]?.n).toBe(0);
    expect(acc.rows[0]?.n).toBe(0);
  });

  it("AC-003-14 deleting a user cascades to their projects (owner_id FK on delete cascade)", async () => {
    await newUser(pg, "doomed", "d2@example.com");
    await pg.query(`INSERT INTO projects (id, owner_id, name) VALUES ('p1', 'doomed', 'Mine')`);
    await pg.query(`DELETE FROM "user" WHERE id = 'doomed'`);
    const r = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM projects WHERE owner_id = 'doomed'`,
    );
    expect(r.rows[0]?.n).toBe(0);
  });
});
