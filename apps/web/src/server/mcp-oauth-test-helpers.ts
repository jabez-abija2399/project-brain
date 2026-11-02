// Test-only helpers for the MCP OAuth flow (mcp-oauth*.test.ts). Not imported by the app.
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach } from "vitest";
import type { SessionUser } from "./auth";
import { authorizeView, decideConsent, exchangeToken, registerClient } from "./mcp-oauth";
import type { TestWorld } from "./test-helpers";

export const ORIGIN = "http://localhost";
export const RESOURCE = `${ORIGIN}/mcp`;
export const REDIRECT = "http://localhost:33418/callback";

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

export function formRequest(url: string, form: Record<string, string>, headers = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(form).toString(),
  });
}

/**
 * Runs the whole consent flow for one user and one project: register a client, look at the consent page, press Allow.
 * Returns the code and the verifier the client would send to /oauth/token.
 */
export async function connect(
  world: TestWorld,
  user: SessionUser,
  projectId: string,
  opts: { now?: Date; redirect?: string; clientName?: string } = {},
) {
  const now = opts.now ?? new Date();
  const redirect = opts.redirect ?? REDIRECT;
  world.signInAs(user);
  const reg = await registerClient(
    world.db,
    jsonRequest(`${ORIGIN}/oauth/register`, {
      client_name: opts.clientName ?? "Claude Desktop",
      redirect_uris: [redirect],
    }),
    now,
  );
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status}`);
  const clientId = (reg.body as { client_id: string }).client_id;
  const { verifier, challenge } = pkce();
  const state = randomBytes(12).toString("hex");
  const query = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
    project_id: projectId,
  };
  const view = await authorizeView(world.db, user, ORIGIN, query);
  if (view.kind !== "consent") throw new Error(`expected the consent view, got ${view.kind}`);
  const result = await decideConsent(
    world.db,
    jsonRequest(
      `${ORIGIN}/oauth/consent`,
      { decision: "allow", ...view.params, csrf: view.csrf },
      { origin: ORIGIN },
    ),
    now,
  );
  if (!("redirect" in result)) throw new Error("consent was not allowed");
  const url = new URL(result.redirect);
  return {
    clientId,
    verifier,
    state,
    redirect,
    code: url.searchParams.get("code") ?? "",
    returnedState: url.searchParams.get("state"),
  };
}

/** Exchanges a code for tokens at /oauth/token (the same function the route calls). */
export async function exchange(
  world: TestWorld,
  input: { clientId: string; code: string; verifier: string; redirect?: string; resource?: string },
  now = new Date(),
) {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirect ?? REDIRECT,
    client_id: input.clientId,
    code_verifier: input.verifier,
  };
  if (input.resource !== undefined) form.resource = input.resource;
  return exchangeToken(world.db, formRequest(`${ORIGIN}/oauth/token`, form), now);
}

export function bearerRequest(path: string, token: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request(`${ORIGIN}${path}`, { method: "POST", ...init, headers });
}

/**
 * Pins the app's origin to the test origin for the file: BETTER_AUTH_URL (which the app prefers over the request's own
 * address) is removed for every test and put back after, so a developer's or CI's environment cannot change the answers.
 */
export function useLocalOrigin(): void {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.BETTER_AUTH_URL;
    Reflect.deleteProperty(process.env, "BETTER_AUTH_URL"); // not `delete`: process.env would keep the text "undefined"
  });
  afterEach(() => {
    if (saved === undefined) Reflect.deleteProperty(process.env, "BETTER_AUTH_URL");
    else process.env.BETTER_AUTH_URL = saved;
  });
}
