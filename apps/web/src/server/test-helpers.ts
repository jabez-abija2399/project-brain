// Test-only module: wire the server helpers to an in-process PGlite database
// so API route tests can exercise the real handlers without a Postgres server.
import { randomUUID } from "node:crypto";
import { checklistItems, fromPglite, usersRepo } from "@brain/db";
import type { BrainDb } from "@brain/db";
import { createTestDb } from "@brain/db/testing";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { type SessionUser, setSessionResolver } from "./auth";
import { setDbForTests } from "./db";

export type TestWorld = {
  pg: PGlite;
  db: BrainDb;
  signInAs: (user: SessionUser | null) => void;
  createUser: (input?: { name?: string; email?: string }) => Promise<SessionUser>;
  teardown: () => Promise<void>;
};

export async function createTestWorld(): Promise<TestWorld> {
  const pg = await createTestDb();
  const db = fromPglite(pg);
  setDbForTests(db);

  let current: SessionUser | null = null;
  setSessionResolver(async () => current);

  const createUser: TestWorld["createUser"] = async (input) => {
    const id = randomUUID();
    const name = input?.name ?? `user-${id.slice(0, 6)}`;
    const email = input?.email ?? `${id.slice(0, 8)}@example.com`;
    await usersRepo.upsertById(db, { id, name, email });
    return { id, name, email };
  };

  return {
    pg,
    db,
    signInAs: (user) => {
      current = user;
    },
    createUser,
    teardown: async () => {
      setSessionResolver(null);
      setDbForTests(null);
      await pg.close();
    },
  };
}

// The confirm/reject API needs the exact proposal the owner saw (FEAT-017). Tests send the item's current proposal,
// looked up in any project so attack tests still reach the access check; an item without one gets a well-formed
// placeholder (the server then answers 404 or 409 as before).
export async function shownProposal(db: BrainDb, itemId: string) {
  const [row] = await db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.id, itemId))
    .limit(1);
  if (row?.proposedChange && row.proposedAt) {
    return { proposedAt: row.proposedAt.toISOString(), change: row.proposedChange };
  }
  return { proposedAt: new Date(0).toISOString(), change: { dismiss: true as const } };
}
