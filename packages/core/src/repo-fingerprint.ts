// Repo fingerprints (2026-11-01, real-test bug J): two different repositories ended up linked to one project. A link
// now carries what identifies its repository: the root commit and the normalized remote URL. Pure; git is read by the
// caller. The server only ever sees hashes of the two parts, never the remote URL itself.
import { createHash } from "node:crypto";

export type RepoFingerprint = { root: string | null; remote: string | null };

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/**
 * A remote URL in one comparable form: host and path, lower case, without scheme, credentials, port, ".git" or a
 * trailing slash. `git@github.com:Acme/App.git`, `https://user:pw@github.com/acme/app` and `ssh://git@github.com/acme/app/`
 * are all `github.com/acme/app`. Anything unreadable is null.
 */
export function normalizeRemote(raw: string | null | undefined): string | null {
  const url = (raw ?? "").trim();
  if (url === "" || url.length > 500) return null;
  let host = "";
  let path = "";
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(url);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      host = u.hostname;
      path = u.pathname;
    } catch {
      return null;
    }
  } else if (scp) {
    host = scp[1] as string;
    path = scp[2] as string;
  } else {
    // A local path remote (another folder on this machine).
    host = "local";
    path = url;
  }
  const clean = path
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "");
  if (!host || !clean) return null;
  return `${host}/${clean}`.toLowerCase();
}

/** The fingerprint from git's answers: the first root commit (if any) and the normalized origin URL (if any). */
export function fingerprintOf(rootCommits: string, originUrl: string | null): RepoFingerprint {
  const root = rootCommits
    .split(/\s+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => SHA.test(s))
    .sort()[0];
  return { root: root ?? null, remote: normalizeRemote(originUrl) };
}

/**
 * Whether a stored fingerprint and the current one can be the same repository: every part known on both sides must be
 * equal. A part unknown on either side (no commit yet, no remote) cannot tell them apart, so it does not count.
 */
export function sameRepo(stored: RepoFingerprint, current: RepoFingerprint): boolean {
  if (stored.root && current.root && stored.root !== current.root) return false;
  if (stored.remote && current.remote && stored.remote !== current.remote) return false;
  return true;
}

const hash = (v: string | null) =>
  v === null ? "" : createHash("sha256").update(v).digest("hex").slice(0, 32);

/** What the server keeps and compares: "r=<hash>;o=<hash>" (empty for an unknown part). Never the URL or commit. */
export function fingerprintToken(fp: RepoFingerprint): string {
  return `r=${hash(fp.root)};o=${hash(fp.remote)}`;
}

const TOKEN = /^r=([0-9a-f]{32})?;o=([0-9a-f]{32})?$/;

/** Parses a token from a request (null when it is not exactly that shape). */
export function parseFingerprintToken(token: string | null | undefined): RepoFingerprint | null {
  const m = TOKEN.exec((token ?? "").trim());
  return m ? { root: m[1] ?? null, remote: m[2] ?? null } : null;
}

/** Fills the parts the stored token does not know yet from the current one (first use of a part). */
export function mergeFingerprints(
  stored: RepoFingerprint,
  current: RepoFingerprint,
): RepoFingerprint {
  return { root: stored.root ?? current.root, remote: stored.remote ?? current.remote };
}

/** A token from parts that are already hashes (the server's side). */
export function tokenFromHashed(fp: RepoFingerprint): string {
  return `r=${fp.root ?? ""};o=${fp.remote ?? ""}`;
}
