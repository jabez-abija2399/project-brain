import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { type BrainDb, RepoAlreadyLinkedError, githubRepo } from "@brain/db";
import { type SessionUser, requireProjectAccess, resolveAuthSecret } from "./auth";
import { AppError } from "./errors";
import { getGithubApp, githubConfig } from "./github";

// An install flow must finish within this time.
const STATE_TTL_MS = 10 * 60 * 1000;
// Repos listed for one installation (one page; more is an edge case for a single-owner v1).
const MAX_REPOS = 100;

const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

function requireConfig() {
  const config = githubConfig();
  if (!config) throw new AppError(503, "github_not_configured");
  return config;
}

// The same answer for an unknown, expired, used or foreign state, so a state cannot be probed.
const invalidState = () =>
  new AppError(400, "invalid_state", "the GitHub install link expired; start again");

/** Step 1 (owner only): a single-use state bound to this user and project, then GitHub's install page. */
export async function startInstall(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  now = new Date(),
): Promise<string> {
  const config = requireConfig();
  await requireProjectAccess(db, projectId, user);
  const state = randomBytes(32).toString("base64url");
  await githubRepo.createState(db, {
    stateHash: hashState(state),
    userId: user.id,
    projectId,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  });
  return `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new?state=${state}`;
}

// The live state of this user's flow, after re-checking that the user still owns the project.
async function ownState(db: BrainDb, user: SessionUser, state: string, now: Date) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(state)) throw invalidState();
  const row = await githubRepo.liveState(db, hashState(state), now);
  if (!row || row.userId !== user.id) throw invalidState();
  await requireProjectAccess(db, row.projectId, user);
  return row;
}

async function installationRepos(installationId: number): Promise<string[]> {
  const octokit = await getGithubApp(requireConfig()).getInstallationOctokit(installationId);
  const res = await octokit.request("GET /installation/repositories", { per_page: MAX_REPOS });
  return (res.data.repositories ?? []).map((r) => r.full_name).sort();
}

// --- Which repositories this person may link (owner-approved fix, 2026-11-11) ---
// An installation can cover repositories the signed-in person cannot read (an organisation installation, or a
// collaborator on one repository of someone else's installation). Only the repositories GitHub lists for this person
// in this installation (GET /user/installations/{id}/repositories, with their own OAuth code) may be offered or
// linked. The OAuth token is used once at the callback and never stored: the allowed list rides to the selection
// screen as a cookie of keyed tags (HMAC with the auth secret, bound to this install's state), so it cannot be
// forged or reused for another install, and no repository name is kept anywhere.
export const ALLOWED_REPOS_COOKIE = "cc_gh_repos";
const TAG_CHARS = 22;

function repoTag(stateHash: string, repo: string): string {
  return createHmac("sha256", resolveAuthSecret(process.env))
    .update(`github-repo-pick\n${stateHash}\n${repo.toLowerCase()}`)
    .digest("base64url")
    .slice(0, TAG_CHARS);
}

/** The cookie value for the repositories this person may pick: one tag per repository. */
export const allowedReposCookie = (stateHash: string, repos: string[]): string =>
  repos.map((r) => repoTag(stateHash, r)).join(".");

function allowedTags(cookie: string | null | undefined): string[] {
  if (!cookie || cookie.length > (TAG_CHARS + 1) * MAX_REPOS) return [];
  return cookie.split(".").filter((t) => /^[A-Za-z0-9_-]+$/.test(t) && t.length === TAG_CHARS);
}

function mayPick(stateHash: string, repo: string, tags: string[]): boolean {
  const want = Buffer.from(repoTag(stateHash, repo));
  let found = false;
  for (const t of tags) {
    const got = Buffer.from(t);
    if (got.length === want.length && timingSafeEqual(got, want)) found = true;
  }
  return found;
}

async function link(
  db: BrainDb,
  user: SessionUser,
  stateHash: string,
  projectId: string,
  installationId: number,
  repo: string,
  now: Date,
): Promise<void> {
  // Single use: only the call that marks the state used may link (parallel callbacks cannot both pass).
  if (!(await githubRepo.useState(db, stateHash, now))) throw invalidState();
  try {
    const linked = await githubRepo.linkProject(db, projectId, user.id, installationId, repo);
    if (!linked) throw new AppError(404, "not_found");
  } catch (err) {
    if (err instanceof RepoAlreadyLinkedError) {
      throw new AppError(409, "repo_already_linked", err.message);
    }
    throw err;
  }
}

/**
 * Step 2, GitHub's redirect after install. The state must be this user's live state for a project they own, and the
 * OAuth code must prove the signed-in GitHub user can access installation_id: a user cannot link an installation id
 * they typed in. One repo: linked now. Several: the user picks one on the selection screen.
 */
export async function completeInstall(
  db: BrainDb,
  user: SessionUser,
  input: { state: string; code: string; installationId: number },
  now = new Date(),
): Promise<{ linked: string } | { choose: true; allowedCookie: string }> {
  const config = requireConfig();
  const row = await ownState(db, user, input.state, now);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.code)) throw invalidState();
  const app = getGithubApp(config);
  let installations: number[];
  let userRepos: string[];
  try {
    const userOctokit = await app.oauth.getUserOctokit({ code: input.code });
    const res = await userOctokit.request("GET /user/installations", { per_page: 100 });
    installations = res.data.installations.map((i) => i.id);
    // Not this GitHub user's installation: reported like a missing one.
    if (!installations.includes(input.installationId)) throw new AppError(404, "not_found");
    const mine = await userOctokit.request(
      "GET /user/installations/{installation_id}/repositories",
      {
        installation_id: input.installationId,
        per_page: MAX_REPOS,
      },
    );
    userRepos = (mine.data.repositories ?? []).map((r) => r.full_name);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw invalidState();
  }

  // Both lists must agree: the installation can see the repository, and so can this person.
  const theirs = new Set(userRepos.map((r) => r.toLowerCase()));
  const repos = (await installationRepos(input.installationId)).filter((r) =>
    theirs.has(r.toLowerCase()),
  );
  if (repos.length === 0) {
    throw new AppError(
      404,
      "no_accessible_repository",
      "This installation has no repository your GitHub account can access.",
    );
  }
  if (repos.length === 1) {
    const repo = repos[0] as string;
    await link(db, user, row.stateHash, row.projectId, input.installationId, repo, now);
    return { linked: repo };
  }
  await githubRepo.setStateInstallation(db, row.stateHash, input.installationId);
  return { choose: true, allowedCookie: allowedReposCookie(row.stateHash, repos) };
}

/** The selection screen's list: the installation's repositories that this person may pick (the cookie's tags). */
export async function listInstallRepos(
  db: BrainDb,
  user: SessionUser,
  state: string,
  allowedCookie: string | null | undefined,
  now = new Date(),
): Promise<{ projectId: string; repos: string[] }> {
  const row = await ownState(db, user, state, now);
  if (row.installationId === null) throw invalidState();
  const tags = allowedTags(allowedCookie);
  if (tags.length === 0) throw invalidState();
  const repos = (await installationRepos(row.installationId)).filter((r) =>
    mayPick(row.stateHash, r, tags),
  );
  return { projectId: row.projectId, repos };
}

/** Step 3 for several repos: link the chosen one, which must be in the installation and one this person may pick. */
export async function linkInstallRepo(
  db: BrainDb,
  user: SessionUser,
  input: { state: string; repo: string },
  allowedCookie: string | null | undefined,
  now = new Date(),
): Promise<{ projectId: string; repo: string }> {
  const row = await ownState(db, user, input.state, now);
  if (row.installationId === null) throw invalidState();
  const tags = allowedTags(allowedCookie);
  if (tags.length === 0) throw invalidState();
  const repos = await installationRepos(row.installationId);
  if (!repos.includes(input.repo) || !mayPick(row.stateHash, input.repo, tags)) {
    throw new AppError(404, "not_found");
  }
  await link(db, user, row.stateHash, row.projectId, row.installationId, input.repo, now);
  return { projectId: row.projectId, repo: input.repo };
}
