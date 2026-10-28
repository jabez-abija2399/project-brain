import { createHash, randomBytes } from "node:crypto";
import { type BrainDb, RepoAlreadyLinkedError, githubRepo } from "@brain/db";
import { type SessionUser, requireProjectAccess } from "./auth";
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
): Promise<{ linked: string } | { choose: true }> {
  const config = requireConfig();
  const row = await ownState(db, user, input.state, now);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.code)) throw invalidState();
  const app = getGithubApp(config);
  let installations: number[];
  try {
    const userOctokit = await app.oauth.getUserOctokit({ code: input.code });
    const res = await userOctokit.request("GET /user/installations", { per_page: 100 });
    installations = res.data.installations.map((i) => i.id);
  } catch {
    throw invalidState();
  }
  // Not this GitHub user's installation: reported like a missing one.
  if (!installations.includes(input.installationId)) throw new AppError(404, "not_found");

  const repos = await installationRepos(input.installationId);
  if (repos.length === 1) {
    const repo = repos[0] as string;
    await link(db, user, row.stateHash, row.projectId, input.installationId, repo, now);
    return { linked: repo };
  }
  await githubRepo.setStateInstallation(db, row.stateHash, input.installationId);
  return { choose: true };
}

/** The selection screen's list: the repos of the installation this user's state proved access to. */
export async function listInstallRepos(
  db: BrainDb,
  user: SessionUser,
  state: string,
  now = new Date(),
): Promise<{ projectId: string; repos: string[] }> {
  const row = await ownState(db, user, state, now);
  if (row.installationId === null) throw invalidState();
  return { projectId: row.projectId, repos: await installationRepos(row.installationId) };
}

/** Step 3 for several repos: link the chosen one, which must belong to the verified installation. */
export async function linkInstallRepo(
  db: BrainDb,
  user: SessionUser,
  input: { state: string; repo: string },
  now = new Date(),
): Promise<{ projectId: string; repo: string }> {
  const row = await ownState(db, user, input.state, now);
  if (row.installationId === null) throw invalidState();
  const repos = await installationRepos(row.installationId);
  if (!repos.includes(input.repo)) throw new AppError(404, "not_found");
  await link(db, user, row.stateHash, row.projectId, row.installationId, input.repo, now);
  return { projectId: row.projectId, repo: input.repo };
}
