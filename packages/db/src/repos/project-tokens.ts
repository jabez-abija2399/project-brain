import { createHash, randomBytes } from "node:crypto";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type ProjectToken, projectTokens, projects } from "../schema";
import { type Page, type PageOptions, pageBounds, toPage } from "./page";

const PREFIX = "pb_";

export const MAX_ACTIVE_TOKENS = 20;

export class TokenLimitError extends Error {
  constructor() {
    super(`a project can have at most ${MAX_ACTIVE_TOKENS} active tokens`);
    this.name = "TokenLimitError";
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): { value: string; hash: string } {
  const value = PREFIX + randomBytes(24).toString("base64url");
  return { value, hash: hashToken(value) };
}

export const projectTokensRepo = {
  // Throws TokenLimitError when the project already has MAX_ACTIVE_TOKENS active tokens.
  async create(db: BrainDb, projectId: string): Promise<{ token: string; row: ProjectToken }> {
    const { value, hash } = generateToken();
    const row = await db.transaction(async (tx) => {
      // Lock the project row so concurrent creates cannot both pass the count check.
      await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .for("update");
      const [active] = await tx
        .select({ n: count() })
        .from(projectTokens)
        .where(and(eq(projectTokens.projectId, projectId), isNull(projectTokens.revokedAt)));
      if ((active?.n ?? 0) >= MAX_ACTIVE_TOKENS) throw new TokenLimitError();
      const [inserted] = await tx.insert(projectTokens).values({ projectId, hash }).returning();
      return inserted;
    });
    if (!row) throw new Error("insert project_tokens returned no row");
    return { token: value, row };
  },

  async listForProject(
    db: BrainDb,
    projectId: string,
    opts?: PageOptions,
  ): Promise<Page<ProjectToken>> {
    const { limit, offset } = pageBounds(opts);
    const rows = await db
      .select()
      .from(projectTokens)
      .where(eq(projectTokens.projectId, projectId))
      .orderBy(desc(projectTokens.createdAt), desc(projectTokens.id))
      .limit(limit + 1)
      .offset(offset);
    return toPage(rows, limit, offset);
  },

  async getById(db: BrainDb, projectId: string, tokenId: string): Promise<ProjectToken | null> {
    const rows = await db
      .select()
      .from(projectTokens)
      .where(and(eq(projectTokens.id, tokenId), eq(projectTokens.projectId, projectId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async revoke(db: BrainDb, projectId: string, tokenId: string): Promise<void> {
    await db
      .update(projectTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(projectTokens.id, tokenId), eq(projectTokens.projectId, projectId)));
  },

  async findActiveByValue(db: BrainDb, token: string): Promise<ProjectToken | null> {
    const hash = hashToken(token);
    const rows = await db
      .select()
      .from(projectTokens)
      .where(and(eq(projectTokens.hash, hash), isNull(projectTokens.revokedAt)))
      .limit(1);
    return rows[0] ?? null;
  },

  async touchLastUsed(db: BrainDb, projectId: string, tokenId: string): Promise<void> {
    await db
      .update(projectTokens)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(projectTokens.id, tokenId), eq(projectTokens.projectId, projectId)));
  },
};
