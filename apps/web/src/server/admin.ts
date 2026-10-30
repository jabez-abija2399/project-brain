import { usersRepo } from "@brain/db";
import { type SessionUser, getAuth } from "./auth";
import { getDb } from "./db";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type LoginResolver = (user: SessionUser, req: Request) => Promise<string | null>;

// GitHub logins: letters, digits and single hyphens, at most 39 characters.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** The login GitHub reports for this access token; null on any failure. */
export async function fetchGithubLogin(
  token: string,
  fetchImpl: Fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl("https://api.github.com/user", {
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "codeceipt",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const login = ((await res.json()) as { login?: unknown }).login;
    return typeof login === "string" && LOGIN.test(login) ? login : null;
  } catch {
    return null;
  }
}

// The login is asked from GitHub with the user's own (stored, encrypted) token on every admin view, never read from
// anything the user can edit, so a renamed or reclaimed login cannot inherit admin rights.
const defaultResolver: LoginResolver = async (user, req) => {
  try {
    const accountId = await usersRepo.githubAccountId(getDb(), user.id);
    if (!accountId) return null;
    const { accessToken } = await getAuth().api.getAccessToken({
      body: { accountId, userId: user.id },
      headers: req.headers,
    });
    return accessToken ? await fetchGithubLogin(accessToken) : null;
  } catch {
    return null;
  }
};
let resolver: LoginResolver = defaultResolver;

/** Test-only: stands in for GitHub. */
export function setGithubLoginResolverForTests(fn: LoginResolver | null) {
  resolver = fn ?? defaultResolver;
}

/** Launch part 5: owners are the GitHub logins in ADMIN_GITHUB_LOGINS (comma separated, any case). */
export async function isAdmin(user: SessionUser, req: Request): Promise<boolean> {
  const admins = (process.env.ADMIN_GITHUB_LOGINS ?? "")
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length > 0);
  if (admins.length === 0) return false;
  const login = await resolver(user, req);
  return login !== null && admins.includes(login.toLowerCase());
}
