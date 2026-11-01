import {
  constants,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join, sep } from "node:path";
import { type RepoFingerprint, fingerprintOf } from "@brain/core";
import type { Git } from "./scan-secrets";

// D-020: one project per repo. The repo's link to its Codeceipt project lives in its own .git folder (never committed,
// never the token): {apiUrl, projectId}. The token for that project stays in the user config.
export type RepoLink = { apiUrl: string; projectId: string; fingerprint?: RepoFingerprint };

const MAX_LINK_BYTES = 4096;
const PROJECT_ID = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * The repo's main .git folder (real path), or null outside a git repo. A git worktree (Claude Code Desktop runs
 * sessions in one) has its own folder under .git/worktrees/, but the link lives in the main .git that every worktree
 * shares, so the common git folder is used; older git without --path-format falls back to the worktree's own.
 */
export async function gitDirOf(git: Git, cwd: string): Promise<string | null> {
  try {
    return realpathSync(
      (await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd)).trim(),
    );
  } catch {
    try {
      return realpathSync((await git(["rev-parse", "--absolute-git-dir"], cwd)).trim());
    } catch {
      return null;
    }
  }
}

// The folder must really be inside .git and not a symlink, so nothing outside the repo is read or written.
function linkDir(gitDir: string, create: boolean): string | null {
  const dir = join(gitDir, "codeceipt");
  try {
    if (create) mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (lstatSync(dir).isSymbolicLink() || !realpathSync(dir).startsWith(gitDir + sep)) return null;
    return dir;
  } catch {
    return null;
  }
}

function validLink(raw: unknown): RepoLink | null {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<RepoLink>;
  if (typeof r.apiUrl !== "string" || typeof r.projectId !== "string") return null;
  if (!PROJECT_ID.test(r.projectId)) return null;
  try {
    const url = new URL(r.apiUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  } catch {
    return null;
  }
  // Real-test bug J: which repository this link belongs to (root commit, normalized remote). Absent in older links.
  const f = (r as { fingerprint?: unknown }).fingerprint as Partial<RepoFingerprint> | undefined;
  const part = (v: unknown) =>
    typeof v === "string" && v.length > 0 && v.length <= 300 ? v : null;
  const fingerprint =
    f && typeof f === "object" ? { root: part(f.root), remote: part(f.remote) } : undefined;
  return { apiUrl: r.apiUrl, projectId: r.projectId, ...(fingerprint ? { fingerprint } : {}) };
}

/** The repo's link, or null when there is none (or it is a symlink, too large or malformed). */
export function readRepoLink(gitDir: string): RepoLink | null {
  const dir = linkDir(gitDir, false);
  if (!dir) return null;
  const file = join(dir, "project.json");
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.size > MAX_LINK_BYTES) return null;
    return validLink(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/** Links the repo to a project. Refuses (returns false) when the folder or file is a symlink. */
export function writeRepoLink(gitDir: string, link: RepoLink): boolean {
  const dir = linkDir(gitDir, true);
  if (!dir || !validLink(link)) return false;
  try {
    // O_NOFOLLOW: a symlink planted at the link file makes the write fail instead of following it.
    const fd = openSync(
      join(dir, "project.json"),
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const valid = validLink(link) as RepoLink;
      writeSync(fd, `${JSON.stringify(valid)}\n`);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

/** Removes the repo's link (`codeceipt unlink`); the project and its token are left as they are. True if one existed. */
export function removeRepoLink(gitDir: string): boolean {
  const dir = linkDir(gitDir, false);
  if (!dir) return false;
  const file = join(dir, "project.json");
  try {
    if (!lstatSync(file).isFile()) return false;
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/** The repository's fingerprint from git: its root commit and origin URL (each null when git has none). */
export async function repoFingerprint(git: Git, root: string): Promise<RepoFingerprint> {
  const roots = await git(["rev-list", "--max-parents=0", "HEAD"], root).catch(() => "");
  const origin = await git(["config", "--get", "remote.origin.url"], root).catch(() => "");
  return fingerprintOf(roots, origin.trim() || null);
}
