import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type ProjectToken, projectTokens } from "../schema";

const PREFIX = "pb_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): { value: string; hash: string } {
  const value = PREFIX + randomBytes(24).toString("base64url");
  return { value, hash: hashToken(value) };
}

export const projectTokensRepo = {
  async create(db: BrainDb, projectId: string): Promise<{ token: string; row: ProjectToken }> {
    const { value, hash } = generateToken();
    const [row] = await db.insert(projectTokens).values({ projectId, hash }).returning();
    if (!row) throw new Error("insert project_tokens returned no row");
    return { token: value, row };
  },

  async listForProject(db: BrainDb, projectId: string): Promise<ProjectToken[]> {
    return db
      .select()
      .from(projectTokens)
      .where(eq(projectTokens.projectId, projectId))
      .orderBy(desc(projectTokens.createdAt));
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

  async touchLastUsed(db: BrainDb, tokenId: string): Promise<void> {
    await db
      .update(projectTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(projectTokens.id, tokenId));
  },
};
