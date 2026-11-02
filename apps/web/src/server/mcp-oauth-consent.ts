// The consent step: GET /oauth/authorize (what the owner sees) and POST /oauth/consent (Allow or Deny).
import { createHmac, randomBytes } from "node:crypto";
import { safeDisplay } from "@brain/core";
import { type BrainDb, hashToken, oauthRepo, projectsRepo } from "@brain/db";
import { z } from "zod";
import {
  type SessionUser,
  appOriginOf,
  requireProjectAccess,
  requireUser,
  resolveAuthSecret,
} from "./auth";
import { readJsonCapped } from "./body";
import { AppError } from "./errors";
import { BODY_LIMIT, CODE_TTL_S, mcpResource, safeEqual } from "./mcp-oauth-shared";
import { rateLimit } from "./rate-limit";
import { SUSPENDED_PROJECT, SUSPENDED_USER, assertNotSuspended } from "./suspension";

const CONSENT_PER_MINUTE = 20;

const UNKNOWN_CLIENT =
  "This connection names a client Codeceipt does not know. Connect it again from the client.";

const NOT_YOURS = "No project of yours has this id.";

const CHALLENGE = /^[A-Za-z0-9._~-]{43,128}$/;

// --- Consent (GET /oauth/authorize, POST /oauth/consent) ---------------------------------------------------------

export type ConsentFields = {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: "S256";
  resource: string;
  project_id: string;
};

export type AuthorizeView =
  | { kind: "error"; message: string }
  | { kind: "pick"; projects: { id: string; name: string }[]; query: Record<string, string> }
  | {
      kind: "consent";
      client: { name: string; host: string };
      project: { id: string; name: string };
      params: ConsentFields;
      csrf: string;
    };

const AUTHORIZE_KEYS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
  "project_id",
] as const;

/** The authorization request as a path on this site (the sign-in return path): only the OAuth parameters. */
export function authorizePathFor(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const key of AUTHORIZE_KEYS) {
    const value = query[key];
    if (value !== undefined) params.set(key, value);
  }
  return `/oauth/authorize?${params.toString()}`;
}

/**
 * A value that proves the consent form came from the consent page for these exact fields and this exact user. It is an
 * HMAC over the fields and the user id, so changing the project, the redirect or another user's session breaks it.
 */
export function consentCsrf(userId: string, f: ConsentFields): string {
  const payload = JSON.stringify([
    userId,
    f.client_id,
    f.redirect_uri,
    f.state,
    f.code_challenge,
    f.code_challenge_method,
    f.resource,
    f.project_id,
  ]);
  return createHmac("sha256", resolveAuthSecret(process.env))
    .update(`oauth-consent\n${payload}`)
    .digest("base64url");
}

/**
 * What the consent page shows: the client, the project (one the user owns), and the form values. Every problem with the
 * request is an error page, never a redirect: a redirect would go to a URI that was not checked.
 */
export async function authorizeView(
  db: BrainDb,
  user: SessionUser,
  origin: string,
  query: Record<string, string | undefined>,
): Promise<AuthorizeView> {
  const q = (key: (typeof AUTHORIZE_KEYS)[number]) => query[key] ?? "";
  const error = (message: string): AuthorizeView => ({ kind: "error", message });
  if (q("response_type") !== "code")
    return error("This connection asks for a flow Codeceipt does not offer.");
  if (!q("client_id")) return error(UNKNOWN_CLIENT);
  const client = await oauthRepo.getClient(db, q("client_id"));
  if (!client) return error(UNKNOWN_CLIENT);
  const redirect = q("redirect_uri");
  if (!redirect || !client.redirectUris.includes(redirect)) {
    return error(
      "The redirect address does not match the one this client registered. Connect it again from the client.",
    );
  }
  if (q("state").length === 0 || q("state").length > 512)
    return error("The connection request has no state value.");
  if (q("code_challenge_method") !== "S256")
    return error("Codeceipt only accepts PKCE with the S256 method.");
  if (!CHALLENGE.test(q("code_challenge")))
    return error("The connection request has no PKCE challenge.");
  if (q("resource") !== mcpResource(origin)) {
    return error("This connection asks for a different server than Codeceipt's MCP server.");
  }
  try {
    await assertNotSuspended(db, user.id);
  } catch (err) {
    if (err instanceof AppError) return error(SUSPENDED_USER);
    throw err;
  }
  const pickQuery = Object.fromEntries(
    AUTHORIZE_KEYS.filter((k) => k !== "project_id").map((k) => [k, q(k)]),
  );
  if (!q("project_id")) {
    const { items } = await listOwned(db, user.id);
    return { kind: "pick", projects: items, query: pickQuery };
  }
  let project: { id: string; name: string };
  try {
    const p = await requireProjectAccess(db, q("project_id"), user);
    project = { id: p.id, name: safeDisplay(p.name, 100) };
  } catch (err) {
    if (err instanceof AppError && err.status === 403) return error(SUSPENDED_PROJECT);
    if (err instanceof AppError && err.status === 404) return error(NOT_YOURS);
    throw err;
  }
  const params: ConsentFields = {
    client_id: client.id,
    redirect_uri: redirect,
    state: q("state"),
    code_challenge: q("code_challenge"),
    code_challenge_method: "S256",
    resource: q("resource"),
    project_id: project.id,
  };
  return {
    kind: "consent",
    client: { name: safeDisplay(client.name, 100), host: new URL(redirect).host },
    project,
    params,
    csrf: consentCsrf(user.id, params),
  };
}

async function listOwned(db: BrainDb, userId: string) {
  const page = await projectsRepo.listByOwner(db, userId, { limit: 100, offset: 0 });
  return { items: page.items.map((p) => ({ id: p.id, name: safeDisplay(p.name, 100) })) };
}

const consentSchema = z
  .object({
    decision: z.enum(["allow", "deny"]),
    client_id: z.string().min(1).max(100),
    redirect_uri: z.string().max(2048),
    state: z.string().min(1).max(512),
    code_challenge: z.string().max(256),
    code_challenge_method: z.literal("S256"),
    resource: z.string().max(512),
    project_id: z.string().min(1).max(100),
    csrf: z.string().max(200),
  })
  .strict();

function withParams(redirect: string, params: Record<string, string>): string {
  const url = new URL(redirect);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * POST /oauth/consent: the signed-in owner allows or denies. Same-origin and JSON only (requireUser), the CSRF value must
 * match the fields and the user, and the project must be the user's own. Allow creates the grant and a single-use code.
 */
export async function decideConsent(
  db: BrainDb,
  req: Request,
  now = new Date(),
): Promise<{ redirect: string }> {
  const user = await requireUser(req);
  await rateLimit(db, `oauth:consent:${user.id}`, CONSENT_PER_MINUTE, now);
  const raw = await readJsonCapped(req, BODY_LIMIT);
  const parsed = consentSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(400, "invalid_input", "the consent form is not valid");
  const f = parsed.data;
  const fields: ConsentFields = {
    client_id: f.client_id,
    redirect_uri: f.redirect_uri,
    state: f.state,
    code_challenge: f.code_challenge,
    code_challenge_method: "S256",
    resource: f.resource,
    project_id: f.project_id,
  };
  if (!safeEqual(f.csrf, consentCsrf(user.id, fields))) {
    throw new AppError(403, "bad_csrf", "this page is out of date: reload it and try again");
  }
  const client = await oauthRepo.getClient(db, f.client_id);
  if (!client || !client.redirectUris.includes(f.redirect_uri))
    throw new AppError(400, "invalid_request", UNKNOWN_CLIENT);
  if (f.resource !== mcpResource(appOriginOf(req)))
    throw new AppError(400, "invalid_request", "wrong resource");
  const project = await requireProjectAccess(db, f.project_id, user);
  if (f.decision === "deny") {
    return { redirect: withParams(f.redirect_uri, { error: "access_denied", state: f.state }) };
  }
  const grant = await oauthRepo.createGrant(db, {
    clientId: client.id,
    projectId: project.id,
    userId: user.id,
    resource: f.resource,
  });
  const code = randomBytes(32).toString("base64url");
  await oauthRepo.issueCode(db, {
    hash: hashToken(code),
    grantId: grant.id,
    redirectUri: f.redirect_uri,
    codeChallenge: f.code_challenge,
    expiresAt: new Date(now.getTime() + CODE_TTL_S * 1000),
  });
  console.info(
    "[mcp-oauth]",
    JSON.stringify({ event: "granted", grantId: grant.id, projectId: project.id }),
  );
  return { redirect: withParams(f.redirect_uri, { code, state: f.state }) };
}
