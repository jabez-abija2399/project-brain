import { randomUUID } from "node:crypto";
import { projectsRepo } from "@brain/db";
import type { BrainDb, Project } from "@brain/db";
import * as schema from "@brain/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "./db";
import { AppError } from "./errors";
import { explainMissingMigrations } from "./migration-check";
import { SUSPENDED_PROJECT, assertNotSuspended } from "./suspension";

export type SessionUser = { id: string; email: string; name: string };

type SessionResolver = (req: Request) => Promise<SessionUser | null>;

const DEV_SECRET = "dev-secret-change-me";

// Production must never fall back to a secret that is readable in this repo:
// better-auth only refuses its own default, so a custom fallback would boot.
export function resolveAuthSecret(env: Record<string, string | undefined>): string {
  const secret = env.BETTER_AUTH_SECRET;
  if (secret) return secret;
  if (env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is not set; refusing to start auth in production");
  }
  return DEV_SECRET;
}

const DAY_S = 24 * 60 * 60;

/**
 * Session safety (2026-11-01): sessions expire after 7 days (renewed at most daily while in use), and the session
 * cookie is httpOnly, sameSite=lax and secure whenever the site is served over https (always in production).
 */
export function sessionSafety(env: Record<string, string | undefined>) {
  const https =
    env.NODE_ENV === "production" ||
    (env.BETTER_AUTH_URL ?? "").toLowerCase().startsWith("https://");
  return {
    session: { expiresIn: 7 * DAY_S, updateAge: DAY_S },
    advanced: {
      useSecureCookies: https,
      defaultCookieAttributes: { httpOnly: true, secure: https, sameSite: "lax" as const },
    },
  };
}

function buildAuth() {
  const db = getDb();
  return betterAuth({
    // usePlural: our drizzle exports are `users`/`sessions`/`accounts`/`verifications`
    // (so other code reads `schema.users` naturally); better-auth otherwise
    // looks for keys named `user`/`session`/…
    database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
    secret: resolveAuthSecret(process.env),
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    // GitHub access tokens are encrypted with the auth secret before they
    // reach the account table, so a database leak does not expose them.
    account: { encryptOAuthTokens: true },
    ...sessionSafety(process.env),
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID || "",
        clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
        // better-auth appends `scope` to its own defaults; disable those so the
        // request is exactly the minimum we need.
        disableDefaultScope: true,
        scope: ["read:user", "user:email"],
        // GitHub's /user returns email: null when the primary address is
        // marked private, even with user:email in scope. Fall back to the
        // user's canonical noreply address so sign-in still works.
        mapProfileToUser: (profile: {
          id: number | string;
          login?: string;
          name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
        }) => ({
          email:
            profile.email ?? `${profile.id}+${profile.login ?? "user"}@users.noreply.github.com`,
          name: profile.name ?? profile.login ?? `github-${profile.id}`,
          image: profile.avatar_url ?? undefined,
        }),
      },
    },
  });
}

type Auth = ReturnType<typeof buildAuth>;
let auth: Auth | null = null;

export function getAuth(): Auth {
  if (!auth) auth = buildAuth();
  return auth;
}

// Default resolver reads the better-auth session from the request headers.
// Tests inject a resolver via setSessionResolver to avoid a real OAuth flow.
// A database that is behind the code (a migration not run) fails here first; the error then names the migration.
const defaultResolver: SessionResolver = async (req) => {
  const session = (await explainMissingMigrations(getDb, () =>
    getAuth().api.getSession({ headers: req.headers }),
  )) as {
    user?: { id: string; email?: string | null; name?: string | null };
  } | null;
  const u = session?.user;
  if (!u) return null;
  return { id: u.id, email: u.email ?? "", name: u.name ?? "" };
};

let resolver: SessionResolver = defaultResolver;

// Test-only: swap how the session is resolved so handlers can be exercised
// without a real GitHub OAuth round-trip. Not used by production code.
export function setSessionResolver(fn: SessionResolver | null) {
  resolver = fn ?? defaultResolver;
}

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  return resolver(req);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The app's own origin: BETTER_AUTH_URL's (the address users sign in on), else the request's. */
export function appOriginOf(req: Request): string {
  try {
    if (process.env.BETTER_AUTH_URL) return new URL(process.env.BETTER_AUTH_URL).origin;
  } catch {}
  return new URL(req.url).origin;
}

// Launch part 4: a state-changing request with the session cookie must come from the app's own pages. Browsers send
// Origin on these requests (Referer as a fallback); a request with neither comes from a non-browser client, which
// cannot ride a victim's cookie, so it passes. "null" (sandboxed frames, some redirects) never matches.
export function assertSameOrigin(req: Request) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  // HTML forms can post across sites without JavaScript, but only as form, multipart or text/plain bodies. Our routes
  // take JSON, so any other declared body type is refused too (a form post that also hides its Origin and Referer).
  const type = req.headers.get("content-type");
  if (type !== null && !/^application\/json\s*(;|$)/i.test(type.trim())) {
    throw new AppError(415, "unsupported_media_type", "send the body as application/json");
  }
  const expected = appOriginOf(req);
  const origin = req.headers.get("origin");
  if (origin !== null) {
    if (origin !== expected) throw new AppError(403, "bad_origin");
    return;
  }
  const referer = req.headers.get("referer");
  if (referer === null) return;
  let refererOrigin = "";
  try {
    refererOrigin = new URL(referer).origin;
  } catch {}
  if (refererOrigin !== expected) throw new AppError(403, "bad_origin");
}

// allowSuspended: the account page's own actions (sign out everywhere, export, delete) still work while suspended.
export async function requireUser(
  req: Request,
  opts: { allowSuspended?: boolean } = {},
): Promise<SessionUser> {
  assertSameOrigin(req);
  const user = await getSessionUser(req);
  if (!user) throw new AppError(401, "unauthenticated");
  if (!opts.allowSuspended) await assertNotSuspended(getDb(), user.id);
  return user;
}

// 404 (never 403) so an unauthorized user cannot distinguish between
// "does not exist" and "belongs to someone else" (IDOR mitigation).
export async function requireProjectAccess(
  db: BrainDb,
  projectId: string,
  user: SessionUser,
): Promise<Project> {
  // A malformed id (empty, huge, a NUL byte from %00) is simply not found, never a database error.
  if (!isPlausibleId(projectId)) throw new AppError(404, "not_found");
  const project = await projectsRepo.get(db, projectId, user.id);
  if (!project) throw new AppError(404, "not_found");
  // Only after ownership is known, so a suspended project is never revealed to anyone else.
  if (project.suspendedAt) throw new AppError(403, "suspended", SUSPENDED_PROJECT);
  return project;
}

// Helper for the sign-in happy path when no real OAuth is wired up:
// create a user row directly (used by tests). Not a production export.
export async function createUserForTests(
  db: BrainDb,
  input: { email: string; name: string },
): Promise<SessionUser> {
  const id = randomUUID();
  await db.insert(schema.users).values({ id, email: input.email, name: input.name });
  return { id, email: input.email, name: input.name };
}

// Ids from URLs are opaque text up to 100 characters with no control characters.
export function isPlausibleId(id: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
  return id.length > 0 && id.length <= 100 && !/[\u0000-\u001f\u007f]/.test(id);
}
