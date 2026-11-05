// MCP OAuth (2026-11-02). MCP clients that cannot run the CLI (Claude Desktop, claude.ai custom connectors, VS Code)
// connect to /mcp by signing in with GitHub. One grant is one signed-in owner's connection of one client to ONE project.
// Only hashes of codes and tokens are stored (oauthRepo). The code lives in mcp-oauth-*.ts; this file re-exports it and
// holds the token check used by /mcp and the account page's connection list.

export * from "./mcp-oauth-shared";
export * from "./mcp-oauth-register";
export * from "./mcp-oauth-consent";
export * from "./mcp-oauth-tokens";

import { safeDisplay } from "@brain/core";
import { type BrainDb, hashToken, oauthRepo } from "@brain/db";
import { type SessionUser, requireUser } from "./auth";
import { AppError } from "./errors";

// --- Using a token at /mcp ---------------------------------------------------------------------------------------

export type OAuthAuth = {
  grantId: string;
  clientId: string;
  projectId: string;
  userId: string;
  expiresAt: Date;
};

/**
 * The grant behind an access token for /mcp, or null: unknown, expired, revoked, or made for another resource. The
 * project comes from the grant only, never from the request.
 */
export async function verifyOAuthAccessToken(
  db: BrainDb,
  token: string,
  resource: string,
  now = new Date(),
): Promise<OAuthAuth | null> {
  if (!token) return null;
  const row = await oauthRepo.activeAccess(db, hashToken(token), now);
  if (!row || row.resource !== resource) return null;
  return {
    grantId: row.grantId,
    clientId: row.clientId,
    projectId: row.projectId,
    userId: row.userId,
    expiresAt: row.expiresAt,
  };
}

// --- The account page ----------------------------------------------------------------------------------------------

export type ConnectionView = {
  id: string;
  clientName: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

/** The signed-in user's connections, newest first. Never a token or a hash. */
export async function connectionsFor(db: BrainDb, user: SessionUser): Promise<ConnectionView[]> {
  const rows = await oauthRepo.listForUser(db, user.id);
  return rows.map((r) => ({
    id: r.grantId,
    clientName: safeDisplay(r.clientName, 100),
    projectId: r.projectId,
    projectName: safeDisplay(r.projectName, 100),
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
  }));
}

/** The account page's Revoke: the owner's own grant only (404 for anyone else), allowed even while suspended. */
export async function revokeConnection(
  db: BrainDb,
  req: Request,
  grantId: string,
  now = new Date(),
): Promise<{ ok: true }> {
  const user = await requireUser(req, { allowSuspended: true });
  if (!(await oauthRepo.revokeGrantForUser(db, user.id, grantId, now))) {
    throw new AppError(404, "not_found");
  }
  console.info("[mcp-oauth]", JSON.stringify({ event: "revoked", grantId }));
  return { ok: true };
}
