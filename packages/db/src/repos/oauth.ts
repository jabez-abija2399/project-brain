import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type OAuthClient,
  type OAuthGrant,
  type OAuthToken,
  oauthClients,
  oauthCodes,
  oauthGrants,
  oauthTokens,
  projects,
} from "../schema";

// MCP OAuth storage (migration 0044). Every value that is a secret arrives here already hashed; this module never
// sees or stores a raw code or token. Every change is keyed by the grant, and grant ids are checked against the user
// wherever a user acts (revokeGrantForUser).

export const MAX_CONNECTIONS = 200;

export type TokenKind = "access" | "refresh";
export type NewToken = { hash: string; grantId: string; kind: TokenKind; expiresAt: Date };

export type ConsumeCodeResult =
  | { status: "ok"; grantId: string; redirectUri: string; codeChallenge: string }
  | { status: "reused"; grantId: string }
  | { status: "invalid" };

export type RotateResult =
  | { status: "rotated"; grantId: string }
  | { status: "reused"; grantId: string }
  | { status: "invalid" };

export type ActiveAccess = {
  grantId: string;
  clientId: string;
  projectId: string;
  userId: string;
  resource: string;
  expiresAt: Date;
};

export type Connection = {
  grantId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export const oauthRepo = {
  async createClient(
    db: BrainDb,
    data: { name: string; redirectUris: string[] },
  ): Promise<OAuthClient> {
    const [row] = await db
      .insert(oauthClients)
      .values({ name: data.name, redirectUris: data.redirectUris })
      .returning();
    if (!row) throw new Error("insert oauth_clients returned no row");
    return row;
  },

  async getClient(db: BrainDb, clientId: string): Promise<OAuthClient | null> {
    const [row] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, clientId))
      .limit(1);
    return row ?? null;
  },

  async createGrant(
    db: BrainDb,
    data: { clientId: string; projectId: string; userId: string; resource: string },
  ): Promise<OAuthGrant> {
    const [row] = await db.insert(oauthGrants).values(data).returning();
    if (!row) throw new Error("insert oauth_grants returned no row");
    return row;
  },

  async getGrant(db: BrainDb, grantId: string): Promise<OAuthGrant | null> {
    const [row] = await db.select().from(oauthGrants).where(eq(oauthGrants.id, grantId)).limit(1);
    return row ?? null;
  },

  async issueCode(
    db: BrainDb,
    data: {
      hash: string;
      grantId: string;
      redirectUri: string;
      codeChallenge: string;
      expiresAt: Date;
    },
  ): Promise<void> {
    await db.insert(oauthCodes).values(data);
  },

  /**
   * Spends an authorization code. One transaction under a row lock: the first use marks it used; a second use reports
   * the grant so the caller can revoke it (RFC 6749 4.1.2); an unknown or expired code is invalid.
   */
  async consumeCode(db: BrainDb, hash: string, now: Date): Promise<ConsumeCodeResult> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(oauthCodes)
        .where(eq(oauthCodes.hash, hash))
        .for("update");
      if (!row) return { status: "invalid" } as const;
      if (row.usedAt !== null) return { status: "reused", grantId: row.grantId } as const;
      if (row.expiresAt.getTime() <= now.getTime()) return { status: "invalid" } as const;
      await tx.update(oauthCodes).set({ usedAt: now }).where(eq(oauthCodes.hash, hash));
      return {
        status: "ok",
        grantId: row.grantId,
        redirectUri: row.redirectUri,
        codeChallenge: row.codeChallenge,
      } as const;
    });
  },

  async insertTokens(db: BrainDb, rows: NewToken[]): Promise<void> {
    if (rows.length === 0) return;
    await db.insert(oauthTokens).values(rows);
  },

  async findToken(db: BrainDb, hash: string): Promise<OAuthToken | null> {
    const [row] = await db.select().from(oauthTokens).where(eq(oauthTokens.hash, hash)).limit(1);
    return row ?? null;
  },

  /**
   * Refresh rotation (one transaction): the presented refresh token is retired (rotated_to names its successor) and the
   * new pair is stored. A token that was already rotated is "reused"; the caller revokes the grant then.
   */
  async rotateRefresh(
    db: BrainDb,
    data: { oldHash: string; next: NewToken[]; now: Date },
  ): Promise<RotateResult> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(oauthTokens)
        .where(and(eq(oauthTokens.hash, data.oldHash), eq(oauthTokens.kind, "refresh")))
        .for("update");
      if (!row) return { status: "invalid" } as const;
      if (row.rotatedTo !== null) return { status: "reused", grantId: row.grantId } as const;
      if (row.revokedAt !== null || row.expiresAt.getTime() <= data.now.getTime()) {
        return { status: "invalid" } as const;
      }
      const successor = data.next.find((t) => t.kind === "refresh");
      if (!successor) throw new Error("rotation needs a new refresh token");
      await tx
        .update(oauthTokens)
        .set({ rotatedTo: successor.hash, revokedAt: data.now })
        .where(eq(oauthTokens.hash, data.oldHash));
      await tx.insert(oauthTokens).values(data.next);
      return { status: "rotated", grantId: row.grantId } as const;
    });
  },

  /** Ends a grant and every token of it, once (existing revocation times are kept). */
  async revokeGrant(db: BrainDb, grantId: string, now: Date): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(oauthGrants)
        .set({ revokedAt: now })
        .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revokedAt)));
      await tx
        .update(oauthTokens)
        .set({ revokedAt: now })
        .where(and(eq(oauthTokens.grantId, grantId), isNull(oauthTokens.revokedAt)));
    });
  },

  /** The owner's own revoke: false when the grant is not theirs (nothing changes then). */
  async revokeGrantForUser(
    db: BrainDb,
    userId: string,
    grantId: string,
    now: Date,
  ): Promise<boolean> {
    const grant = await oauthRepo.getGrant(db, grantId);
    if (!grant || grant.userId !== userId) return false;
    await oauthRepo.revokeGrant(db, grantId, now);
    return true;
  },

  async touchGrant(db: BrainDb, grantId: string, now: Date): Promise<void> {
    await db.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, grantId));
  },

  /**
   * The grant behind an access token, when the token is usable at `now`: an access token, not revoked, not expired,
   * on a grant that is not revoked. Anything else is null.
   */
  async activeAccess(db: BrainDb, hash: string, now: Date): Promise<ActiveAccess | null> {
    const [row] = await db
      .select({
        grantId: oauthGrants.id,
        clientId: oauthGrants.clientId,
        projectId: oauthGrants.projectId,
        userId: oauthGrants.userId,
        resource: oauthGrants.resource,
        expiresAt: oauthTokens.expiresAt,
      })
      .from(oauthTokens)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grantId))
      .where(
        and(
          eq(oauthTokens.hash, hash),
          eq(oauthTokens.kind, "access"),
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.expiresAt, now),
          isNull(oauthGrants.revokedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /** The user's own connections, newest first. Never a token or a hash. */
  async listForUser(db: BrainDb, userId: string): Promise<Connection[]> {
    return db
      .select({
        grantId: oauthGrants.id,
        clientName: oauthClients.name,
        projectId: oauthGrants.projectId,
        projectName: projects.name,
        createdAt: oauthGrants.createdAt,
        lastUsedAt: oauthGrants.lastUsedAt,
        revokedAt: oauthGrants.revokedAt,
      })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .innerJoin(projects, eq(projects.id, oauthGrants.projectId))
      .where(eq(oauthGrants.userId, userId))
      .orderBy(desc(oauthGrants.createdAt), desc(oauthGrants.id))
      .limit(MAX_CONNECTIONS);
  },
};
