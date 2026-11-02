// The token endpoints: POST /oauth/token (code exchange and refresh rotation) and POST /oauth/revoke (RFC 7009).
import { createHash, randomBytes } from "node:crypto";
import { type BrainDb, hashToken, oauthRepo } from "@brain/db";
import { appOriginOf } from "./auth";
import { readCapped } from "./body";
import {
  ACCESS_TTL_S,
  BODY_LIMIT,
  type Json,
  REFRESH_TTL_S,
  TOKEN_PREFIX,
  fail,
  mcpResource,
  safeEqual,
} from "./mcp-oauth-shared";

// --- Tokens (POST /oauth/token, POST /oauth/revoke) --------------------------------------------------------------

const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

function pkceMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier)) return false;
  return safeEqual(createHash("sha256").update(verifier).digest("base64url"), challenge);
}

function newTokens(grantId: string, now: Date) {
  const access = TOKEN_PREFIX.access + randomBytes(32).toString("base64url");
  const refresh = TOKEN_PREFIX.refresh + randomBytes(32).toString("base64url");
  const rows = [
    {
      hash: hashToken(access),
      grantId,
      kind: "access" as const,
      expiresAt: new Date(now.getTime() + ACCESS_TTL_S * 1000),
    },
    {
      hash: hashToken(refresh),
      grantId,
      kind: "refresh" as const,
      expiresAt: new Date(now.getTime() + REFRESH_TTL_S * 1000),
    },
  ];
  return { access, refresh, rows };
}

async function readForm(req: Request): Promise<URLSearchParams | null> {
  const text = await readCapped(req, BODY_LIMIT);
  if (text === null) return null;
  if (/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return new URLSearchParams();
    }
    const params = new URLSearchParams();
    if (json && typeof json === "object" && !Array.isArray(json)) {
      for (const [k, v] of Object.entries(json)) if (typeof v === "string") params.set(k, v);
    }
    return params;
  }
  return new URLSearchParams(text);
}

/** POST /oauth/token: the authorization code grant (PKCE, single use, 60 s) and the refresh grant (rotation). */
export async function exchangeToken(db: BrainDb, req: Request, now = new Date()): Promise<Json> {
  const form = await readForm(req);
  if (form === null) return fail(400, "invalid_request", "the request is too large");
  const origin = appOriginOf(req);
  const resource = form.get("resource");
  if (resource !== null && resource !== mcpResource(origin)) {
    return fail(400, "invalid_target", "this server only issues tokens for its /mcp resource");
  }
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") return codeGrant(db, form, origin, now);
  if (grantType === "refresh_token") return refreshGrant(db, form, origin, now);
  return fail(400, "unsupported_grant_type", "use authorization_code or refresh_token");
}

async function codeGrant(
  db: BrainDb,
  form: URLSearchParams,
  origin: string,
  now: Date,
): Promise<Json> {
  const code = form.get("code") ?? "";
  const redirect = form.get("redirect_uri") ?? "";
  const clientId = form.get("client_id") ?? "";
  const verifier = form.get("code_verifier") ?? "";
  if (!code || !redirect || !clientId || !verifier) {
    return fail(
      400,
      "invalid_request",
      "code, redirect_uri, client_id and code_verifier are required",
    );
  }
  // Every check runs before the code is spent: a request that fails one of them (a wrong client, redirect address or
  // verifier) changes nothing, so a stolen code cannot be burned, and the legitimate exchange still works.
  const info = await oauthRepo.peekCode(db, hashToken(code));
  if (!info) return fail(400, "invalid_grant", "the code is wrong, used or expired");
  const grant = await oauthRepo.getGrant(db, info.grantId);
  if (
    !grant ||
    grant.revokedAt !== null ||
    grant.clientId !== clientId ||
    info.redirectUri !== redirect ||
    !pkceMatches(verifier, info.codeChallenge)
  ) {
    return fail(
      400,
      "invalid_grant",
      "the code does not match this client, redirect address or verifier",
    );
  }
  if (info.usedAt !== null) {
    // The right client, redirect address and verifier, and a code used before: it leaked, so its grant is ended
    // (RFC 6749 section 4.1.2). Only a request that passed the checks above can end a grant this way.
    await oauthRepo.revokeGrant(db, grant.id, now);
    return fail(400, "invalid_grant", "the code was already used; the connection was ended");
  }
  if (info.expiresAt.getTime() <= now.getTime())
    return fail(400, "invalid_grant", "the code is wrong, used or expired");
  if (grant.resource !== mcpResource(origin)) return fail(400, "invalid_target", "wrong resource");
  // The single-use step itself: a concurrent exchange that spent the code first is a reuse.
  const spent = await oauthRepo.consumeCode(db, hashToken(code), now);
  if (spent.status === "invalid")
    return fail(400, "invalid_grant", "the code is wrong, used or expired");
  if (spent.status === "reused") {
    await oauthRepo.revokeGrant(db, grant.id, now);
    return fail(400, "invalid_grant", "the code was already used; the connection was ended");
  }
  const tokens = newTokens(grant.id, now);
  await oauthRepo.insertTokens(db, tokens.rows);
  return tokenBody(tokens.access, tokens.refresh);
}

async function refreshGrant(
  db: BrainDb,
  form: URLSearchParams,
  origin: string,
  now: Date,
): Promise<Json> {
  const refresh = form.get("refresh_token") ?? "";
  const clientId = form.get("client_id") ?? "";
  if (!refresh || !clientId)
    return fail(400, "invalid_request", "refresh_token and client_id are required");
  const row = await oauthRepo.findToken(db, hashToken(refresh));
  if (!row || row.kind !== "refresh")
    return fail(400, "invalid_grant", "the refresh token is wrong, revoked or expired");
  const grant = await oauthRepo.getGrant(db, row.grantId);
  if (!grant || grant.clientId !== clientId) {
    return fail(400, "invalid_grant", "the refresh token does not belong to this client");
  }
  // A revoked grant refreshes nothing (a revoke that landed first must stay effective; rotateRefresh checks it again
  // under the grant's row lock).
  if (grant.revokedAt !== null) {
    return fail(400, "invalid_grant", "the connection was ended");
  }
  if (grant.resource !== mcpResource(origin)) return fail(400, "invalid_target", "wrong resource");
  const tokens = newTokens(grant.id, now);
  const result = await oauthRepo.rotateRefresh(db, { oldHash: row.hash, next: tokens.rows, now });
  if (result.status === "reused") {
    // An old refresh token used again: someone holds a copy. The grant and every token of it end.
    await oauthRepo.revokeGrant(db, result.grantId, now);
    return fail(
      400,
      "invalid_grant",
      "the refresh token was already used; the connection was ended",
    );
  }
  if (result.status === "invalid")
    return fail(400, "invalid_grant", "the refresh token is wrong, revoked or expired");
  return tokenBody(tokens.access, tokens.refresh);
}

function tokenBody(access: string, refresh: string): Json {
  return {
    status: 200,
    body: {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_S,
      refresh_token: refresh,
    },
  };
}

/**
 * POST /oauth/revoke (RFC 7009): ends the grant of the token. Always 200 for a token that exists or not, so the answer
 * reveals nothing. A client_id that does not match the grant changes nothing.
 */
export async function revokeToken(db: BrainDb, req: Request, now = new Date()): Promise<Json> {
  const form = await readForm(req);
  if (form === null) return fail(400, "invalid_request", "the request is too large");
  const token = form.get("token") ?? "";
  if (!token) return fail(400, "invalid_request", "token is required");
  const row = await oauthRepo.findToken(db, hashToken(token));
  if (row) {
    const grant = await oauthRepo.getGrant(db, row.grantId);
    const clientId = form.get("client_id");
    if (grant && (!clientId || clientId === grant.clientId))
      await oauthRepo.revokeGrant(db, grant.id, now);
  }
  return { status: 200, body: {} };
}
