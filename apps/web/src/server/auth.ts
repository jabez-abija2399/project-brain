import { randomUUID } from "node:crypto";
import { projectsRepo } from "@brain/db";
import type { BrainDb, Project } from "@brain/db";
import * as schema from "@brain/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "./db";
import { AppError } from "./errors";

export type SessionUser = { id: string; email: string; name: string };

type SessionResolver = (req: Request) => Promise<SessionUser | null>;

function buildAuth() {
  const db = getDb();
  return betterAuth({
    // usePlural: our drizzle exports are `users`/`sessions`/`accounts`/`verifications`
    // (so other code reads `schema.users` naturally); better-auth otherwise
    // looks for keys named `user`/`session`/…
    database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
    secret: process.env.BETTER_AUTH_SECRET || "dev-secret-change-me",
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID || "",
        clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
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
const defaultResolver: SessionResolver = async (req) => {
  const session = (await getAuth().api.getSession({ headers: req.headers })) as {
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

export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await getSessionUser(req);
  if (!user) throw new AppError(401, "unauthenticated");
  return user;
}

// 404 (never 403) so an unauthorized user cannot distinguish between
// "does not exist" and "belongs to someone else" (IDOR mitigation).
export async function requireProjectAccess(
  db: BrainDb,
  projectId: string,
  user: SessionUser,
): Promise<Project> {
  const project = await projectsRepo.get(db, projectId, user.id);
  if (!project) throw new AppError(404, "not_found");
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
