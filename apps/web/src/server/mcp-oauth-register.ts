// Dynamic client registration (RFC 7591): POST /oauth/register. Public clients only (no secret).
import { type BrainDb, oauthRepo } from "@brain/db";
import { z } from "zod";
import { readCapped } from "./body";
import { clientKey } from "./device";
import { BODY_LIMIT, type Json, fail } from "./mcp-oauth-shared";
import { rateLimit } from "./rate-limit";
import { UNSAFE_NAME_CHARS } from "./validate";

const REGISTER_PER_MINUTE = 10;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Control, bidirectional and invisible characters (the same set as UNSAFE_NAME_CHARS, without its global flag).
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
const NON_PRINTABLE = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

// --- Dynamic client registration (RFC 7591) ----------------------------------------------------------------------

/** https anywhere, or http on a loopback address only (localhost, 127.0.0.1, [::1]); no fragment, no credentials. */
export function isAllowedRedirectUri(raw: string): boolean {
  if (raw.length === 0 || raw.length > 2048 || NON_PRINTABLE.test(raw) || raw.includes("#"))
    return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return url.hostname !== "";
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

const registerSchema = z.object({
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).optional(),
  response_types: z.array(z.literal("code")).optional(),
});

/** POST /oauth/register: a public client (no secret), per address rate limited, bodies capped. */
export async function registerClient(db: BrainDb, req: Request, now = new Date()): Promise<Json> {
  await rateLimit(db, `oauth:register:${clientKey(req)}`, REGISTER_PER_MINUTE, now);
  const raw = await readCapped(req, BODY_LIMIT);
  if (raw === null) return fail(413, "invalid_client_metadata", "the request is too large");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail(400, "invalid_client_metadata", "the body must be JSON");
  }
  const parsed = registerSchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      400,
      "invalid_client_metadata",
      "redirect_uris (1 to 10) is required; clients are public",
    );
  }
  const uris = parsed.data.redirect_uris;
  if (!uris.every(isAllowedRedirectUri)) {
    return fail(
      400,
      "invalid_redirect_uri",
      "redirect URIs must be https, or http on localhost, 127.0.0.1 or [::1]",
    );
  }
  // The name is shown on the consent page: control and direction-changing characters are removed, never shown.
  const name =
    (parsed.data.client_name ?? "").replace(UNSAFE_NAME_CHARS, "").trim().slice(0, 100) ||
    "Unnamed MCP client";
  const client = await oauthRepo.createClient(db, { name, redirectUris: uris });
  return {
    status: 201,
    body: {
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  };
}
