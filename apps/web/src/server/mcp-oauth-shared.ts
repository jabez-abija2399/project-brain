// Shared pieces of MCP OAuth: constants, the JSON result of the protocol endpoints, discovery metadata and the 401.
import { timingSafeEqual } from "node:crypto";

export const CODE_TTL_S = 60;

export const ACCESS_TTL_S = 60 * 60;

export const REFRESH_TTL_S = 30 * 24 * 60 * 60;

export const BODY_LIMIT = 8192;

export const TOKEN_PREFIX = { access: "oat_", refresh: "ort_" } as const;

export const SIGN_IN_HINT =
  "Connect this client: run `npx codeceipt` in your repository, or sign in to Codeceipt with this client.";

export type Json = { status: number; body: Record<string, unknown> };

export const fail = (status: number, error: string, description: string): Json => ({
  status,
  body: { error, error_description: description },
});

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// --- Resource and metadata -----------------------------------------------------------------------------------------

/** The one resource this server issues tokens for: its /mcp URL (RFC 8707). */
export const mcpResource = (origin: string) => `${origin}/mcp`;

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource_name: "Codeceipt",
  };
}

/** A missing or invalid token: 401, the challenge that points at the metadata, and the text that says what to do. */
export function unauthorizedResponse(origin: string, presented: boolean): Response {
  return new Response(
    JSON.stringify({
      error: presented ? "invalid_token" : "unauthorized",
      error_description: SIGN_IN_HINT,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      },
    },
  );
}
