import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrainDb } from "../db";
import { fromPglite } from "../pglite";
import { oauthTokens } from "../schema";
import { createTestDb } from "../testing";
import { oauthRepo } from "./oauth";
import { projectsRepo } from "./projects";
import { usersRepo } from "./users";

const RESOURCE = "https://codeceipt.example/mcp";
const HOUR = 3_600_000;
const MIN = 60_000;

let pg: PGlite;
let db: BrainDb;

async function person(name: string) {
  const id = randomUUID();
  await usersRepo.upsertById(db, { id, name, email: `${id.slice(0, 8)}@example.com` });
  return id;
}

async function project(ownerId: string, name: string) {
  const row = await projectsRepo.create(db, ownerId, { name });
  return row.id;
}

beforeEach(async () => {
  pg = await createTestDb();
  db = fromPglite(pg);
});
afterEach(async () => {
  await pg.close();
});

describe("oauthRepo", () => {
  it("a grant ties one client to one project and one user, and reads back", async () => {
    const owner = await person("owner");
    const p = await project(owner, "Shop");
    const client = await oauthRepo.createClient(db, {
      name: "Claude Desktop",
      redirectUris: ["http://localhost:33418/callback"],
    });
    const grant = await oauthRepo.createGrant(db, {
      clientId: client.id,
      projectId: p,
      userId: owner,
      resource: RESOURCE,
    });
    expect(grant.projectId).toBe(p);
    expect(grant.revokedAt).toBeNull();
    expect((await oauthRepo.getGrant(db, grant.id))?.userId).toBe(owner);
  });

  it("attack: a code is single use; the second use reports the grant to revoke, never a second token", async () => {
    const owner = await person("owner");
    const p = await project(owner, "Shop");
    const client = await oauthRepo.createClient(db, { name: "c", redirectUris: [] });
    const grant = await oauthRepo.createGrant(db, {
      clientId: client.id,
      projectId: p,
      userId: owner,
      resource: RESOURCE,
    });
    const now = new Date();
    await oauthRepo.issueCode(db, {
      hash: "code-hash-1",
      grantId: grant.id,
      redirectUri: "http://localhost:1/cb",
      codeChallenge: "challenge",
      expiresAt: new Date(now.getTime() + MIN),
    });
    const first = await oauthRepo.consumeCode(db, "code-hash-1", now);
    expect(first).toMatchObject({ status: "ok", grantId: grant.id });
    const second = await oauthRepo.consumeCode(db, "code-hash-1", now);
    expect(second).toEqual({ status: "reused", grantId: grant.id });
  });

  it("attack: an expired code is refused and never marked as used", async () => {
    const owner = await person("owner");
    const p = await project(owner, "Shop");
    const client = await oauthRepo.createClient(db, { name: "c", redirectUris: [] });
    const grant = await oauthRepo.createGrant(db, {
      clientId: client.id,
      projectId: p,
      userId: owner,
      resource: RESOURCE,
    });
    const now = new Date();
    await oauthRepo.issueCode(db, {
      hash: "code-hash-2",
      grantId: grant.id,
      redirectUri: "http://localhost:1/cb",
      codeChallenge: "challenge",
      expiresAt: new Date(now.getTime() + MIN),
    });
    const late = new Date(now.getTime() + 2 * MIN);
    expect(await oauthRepo.consumeCode(db, "code-hash-2", late)).toEqual({ status: "invalid" });
  });

  it("a refresh token rotates once: the old one is marked as rotated and reuse is reported", async () => {
    const owner = await person("owner");
    const p = await project(owner, "Shop");
    const client = await oauthRepo.createClient(db, { name: "c", redirectUris: [] });
    const grant = await oauthRepo.createGrant(db, {
      clientId: client.id,
      projectId: p,
      userId: owner,
      resource: RESOURCE,
    });
    const now = new Date();
    await oauthRepo.insertTokens(db, [
      {
        hash: "rt-1",
        grantId: grant.id,
        kind: "refresh",
        expiresAt: new Date(now.getTime() + HOUR),
      },
    ]);
    const rotated = await oauthRepo.rotateRefresh(db, {
      oldHash: "rt-1",
      next: [
        {
          hash: "at-2",
          grantId: grant.id,
          kind: "access",
          expiresAt: new Date(now.getTime() + HOUR),
        },
        {
          hash: "rt-2",
          grantId: grant.id,
          kind: "refresh",
          expiresAt: new Date(now.getTime() + HOUR),
        },
      ],
      now,
    });
    expect(rotated).toEqual({ status: "rotated", grantId: grant.id });
    expect((await oauthRepo.findToken(db, "rt-1"))?.rotatedTo).toBe("rt-2");
    expect(
      await oauthRepo.rotateRefresh(db, {
        oldHash: "rt-1",
        next: [
          {
            hash: "at-3",
            grantId: grant.id,
            kind: "access",
            expiresAt: new Date(now.getTime() + HOUR),
          },
          {
            hash: "rt-3",
            grantId: grant.id,
            kind: "refresh",
            expiresAt: new Date(now.getTime() + HOUR),
          },
        ],
        now,
      }),
    ).toEqual({ status: "reused", grantId: grant.id });
    expect(await oauthRepo.findToken(db, "rt-3")).toBeNull();
  });

  it("attack: a user cannot revoke another user's grant, and nothing changes", async () => {
    const owner = await person("owner");
    const stranger = await person("stranger");
    const p = await project(owner, "Shop");
    const client = await oauthRepo.createClient(db, { name: "c", redirectUris: [] });
    const grant = await oauthRepo.createGrant(db, {
      clientId: client.id,
      projectId: p,
      userId: owner,
      resource: RESOURCE,
    });
    expect(await oauthRepo.revokeGrantForUser(db, stranger, grant.id, new Date())).toBe(false);
    expect((await oauthRepo.getGrant(db, grant.id))?.revokedAt).toBeNull();
  });

  it("the connections list shows only the user's own grants, with client and project names", async () => {
    const owner = await person("owner");
    const other = await person("other");
    const p = await project(owner, "Shop");
    const q = await project(other, "Their shop");
    const client = await oauthRepo.createClient(db, { name: "VS Code", redirectUris: [] });
    await oauthRepo.createGrant(db, {
      clientId: client.id,
      projectId: p,
      userId: owner,
      resource: RESOURCE,
    });
    await oauthRepo.createGrant(db, {
      clientId: client.id,
      projectId: q,
      userId: other,
      resource: RESOURCE,
    });
    const rows = await oauthRepo.listForUser(db, owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clientName: "VS Code", projectName: "Shop", projectId: p });
  });

  it("revoking a grant ends its access token at once and its refresh token too", async () => {
    const owner = await person("owner");
    const p = await project(owner, "Shop");
    const client = await oauthRepo.createClient(db, { name: "c", redirectUris: [] });
    const grant = await oauthRepo.createGrant(db, {
      clientId: client.id,
      projectId: p,
      userId: owner,
      resource: RESOURCE,
    });
    const now = new Date();
    await oauthRepo.insertTokens(db, [
      {
        hash: "at-x",
        grantId: grant.id,
        kind: "access",
        expiresAt: new Date(now.getTime() + HOUR),
      },
      {
        hash: "rt-x",
        grantId: grant.id,
        kind: "refresh",
        expiresAt: new Date(now.getTime() + HOUR),
      },
    ]);
    expect(await oauthRepo.activeAccess(db, "at-x", now)).not.toBeNull();
    await oauthRepo.revokeGrant(db, grant.id, now);
    expect(await oauthRepo.activeAccess(db, "at-x", now)).toBeNull();
    expect((await oauthRepo.findToken(db, "rt-x"))?.revokedAt).not.toBeNull();
  });

  it("attack: an access token past its expiry is not active", async () => {
    const owner = await person("owner");
    const p = await project(owner, "Shop");
    const client = await oauthRepo.createClient(db, { name: "c", redirectUris: [] });
    const grant = await oauthRepo.createGrant(db, {
      clientId: client.id,
      projectId: p,
      userId: owner,
      resource: RESOURCE,
    });
    const now = new Date();
    await oauthRepo.insertTokens(db, [
      {
        hash: "at-old",
        grantId: grant.id,
        kind: "access",
        expiresAt: new Date(now.getTime() + HOUR),
      },
    ]);
    expect(
      await oauthRepo.activeAccess(db, "at-old", new Date(now.getTime() + 2 * HOUR)),
    ).toBeNull();
  });
});

describe("oauthRepo: review fixes", () => {
  it("attack: a refresh rotation on a revoked grant is refused and inserts no tokens", async () => {
    const owner = await person("owner");
    const p = await project(owner, "Shop");
    const client = await oauthRepo.createClient(db, { name: "c", redirectUris: [] });
    const grant = await oauthRepo.createGrant(db, {
      clientId: client.id,
      projectId: p,
      userId: owner,
      resource: RESOURCE,
    });
    const now = new Date();
    await oauthRepo.insertTokens(db, [
      {
        hash: "rt-revoked-grant",
        grantId: grant.id,
        kind: "refresh",
        expiresAt: new Date(now.getTime() + HOUR),
      },
    ]);
    // Only the grant is revoked here: the racing revoke has not reached this refresh token yet.
    await oauthRepo.revokeGrant(db, grant.id, now);
    await db
      .update(oauthTokens)
      .set({ revokedAt: null })
      .where(eq(oauthTokens.hash, "rt-revoked-grant"));
    const result = await oauthRepo.rotateRefresh(db, {
      oldHash: "rt-revoked-grant",
      next: [
        {
          hash: "at-after-revoke",
          grantId: grant.id,
          kind: "access",
          expiresAt: new Date(now.getTime() + HOUR),
        },
        {
          hash: "rt-after-revoke",
          grantId: grant.id,
          kind: "refresh",
          expiresAt: new Date(now.getTime() + HOUR),
        },
      ],
      now,
    });
    expect(result).toEqual({ status: "invalid" });
    expect(await oauthRepo.findToken(db, "rt-after-revoke")).toBeNull();
    expect(await oauthRepo.findToken(db, "rt-revoked-grant")).toMatchObject({ rotatedTo: null });
  });

  it("countClients counts every registered client", async () => {
    expect(await oauthRepo.countClients(db)).toBe(0);
    await oauthRepo.createClient(db, { name: "a", redirectUris: [] });
    await oauthRepo.createClient(db, { name: "b", redirectUris: [] });
    expect(await oauthRepo.countClients(db)).toBe(2);
  });
});
