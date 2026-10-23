// Test-only module: wire the server helpers to an in-process PGlite database
// so API route tests can exercise the real handlers without a Postgres server.
import { randomUUID } from "node:crypto";
import { fromPglite, usersRepo } from "@brain/db";
import type { BrainDb } from "@brain/db";
import { createTestDb } from "@brain/db/testing";
import type { PGlite } from "@electric-sql/pglite";
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
