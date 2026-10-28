import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../db";
import { createTestDb } from "../testing";
import {
  RepoAlreadyLinkedError,
  codeIndexRepo,
  dbTablesRepo,
  filesRepo,
  githubRepo,
  projectsRepo,
  usersRepo,
} from "./index";

describe("FEAT-009 githubRepo", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let db: ReturnType<typeof fromPglite>;
  let mine: string;
  let other: string;
  beforeEach(async () => {
    pg = await createTestDb();
    db = fromPglite(pg);
    await usersRepo.upsertById(db, { id: "u1", name: "u1", email: "u1@example.com" });
    await usersRepo.upsertById(db, { id: "u2", name: "u2", email: "u2@example.com" });
    mine = (await projectsRepo.create(db, "u1", { name: "mine" })).id;
    other = (await projectsRepo.create(db, "u2", { name: "other" })).id;
  });
  afterEach(async () => {
    await pg.close();
  });

  it("AC-009-04 a delivery id is recorded once; the replay returns false", async () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(await githubRepo.recordDelivery(db, "d-1", now)).toBe(true);
    expect(await githubRepo.recordDelivery(db, "d-1", now)).toBe(false);
    await githubRepo.forgetDelivery(db, "d-1");
    expect(await githubRepo.recordDelivery(db, "d-1", now)).toBe(true);
  });

  it("AC-009-01 attack: a state is single use and expires; parallel uses let exactly one through", async () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await githubRepo.createState(db, { stateHash: "s1", userId: "u1", projectId: mine, expiresAt });
    expect(await githubRepo.liveState(db, "s1", now)).not.toBeNull();
    const results = await Promise.all([
      githubRepo.useState(db, "s1", now),
      githubRepo.useState(db, "s1", now),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await githubRepo.liveState(db, "s1", now)).toBeNull();

    await githubRepo.createState(db, { stateHash: "s2", userId: "u1", projectId: mine, expiresAt });
    const late = new Date(expiresAt.getTime() + 1);
    expect(await githubRepo.liveState(db, "s2", late)).toBeNull();
    expect(await githubRepo.useState(db, "s2", late)).toBe(false);
  });

  it("AC-009-01 attack: linking needs the project's owner; uninstalling unlinks", async () => {
    expect(await githubRepo.linkProject(db, other, "u1", 42, "acme/app")).toBeNull();
    expect(await githubRepo.linkProject(db, mine, "u1", 42, "acme/app")).toEqual({ id: mine });
    expect(await githubRepo.linkedProjects(db, 42, "acme/app")).toEqual([{ id: mine }]);
    expect(await githubRepo.linkedProjects(db, 43, "acme/app")).toEqual([]);
    expect(await githubRepo.isLinked(db, mine, 42, "acme/app")).toBe(true);
    expect(await githubRepo.isLinked(db, other, 42, "acme/app")).toBe(false);

    const second = (await projectsRepo.create(db, "u1", { name: "second" })).id;
    await expect(githubRepo.linkProject(db, second, "u1", 42, "acme/app")).rejects.toBeInstanceOf(
      RepoAlreadyLinkedError,
    );

    expect(await githubRepo.unlinkInstallation(db, 42)).toBe(1);
    expect(await githubRepo.linkedProjects(db, 42, "acme/app")).toEqual([]);
  });

  it("AC-009-02 removeMissing with only deletes exactly those paths of this project", async () => {
    const h = (c: string) => c.repeat(64);
    await filesRepo.insert(db, mine, { path: "src/a.ts", hash: h("a") });
    await filesRepo.insert(db, mine, { path: "src/b.ts", hash: h("b") });
    await filesRepo.insert(db, other, { path: "src/a.ts", hash: h("a") });
    const result = await codeIndexRepo.removeMissing(db, mine, {
      after: null,
      through: null,
      keep: [],
      only: ["src/a.ts"],
      final: true,
    });
    expect(result.deleted).toEqual(["src/a.ts"]);
    expect((await filesRepo.list(db, mine)).map((f) => f.path)).toEqual(["src/b.ts"]);
    expect((await filesRepo.list(db, other)).map((f) => f.path)).toEqual(["src/a.ts"]);
    const none = await codeIndexRepo.removeMissing(db, mine, {
      after: null,
      through: null,
      keep: [],
      only: [],
      final: true,
    });
    expect(none.deleted).toEqual([]);
    expect((await filesRepo.list(db, mine)).map((f) => f.path)).toEqual(["src/b.ts"]);
  });

  it("AC-009-05 fail closed: markAllRlsUnknown leaves no table enabled, only this project's tables", async () => {
    const sqlPath = "supabase/migrations/0001_orders.sql";
    const mineFile = await filesRepo.insert(db, mine, { path: sqlPath, hash: "c".repeat(64) });
    const otherFile = await filesRepo.insert(db, other, { path: sqlPath, hash: "c".repeat(64) });
    await dbTablesRepo.insert(db, mine, {
      fileId: mineFile.id,
      schema: "public",
      name: "orders",
      rlsEnabled: true,
    });
    await dbTablesRepo.insert(db, other, {
      fileId: otherFile.id,
      schema: "public",
      name: "orders",
      rlsEnabled: true,
    });
    expect(await dbTablesRepo.markAllRlsUnknown(db, mine)).toBe(1);
    const [t] = await dbTablesRepo.list(db, mine);
    expect(t).toMatchObject({ rlsEnabled: false, rlsUnknown: true });
    const [o] = await dbTablesRepo.list(db, other);
    expect(o).toMatchObject({ rlsEnabled: true, rlsUnknown: false });
  });
});
