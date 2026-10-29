import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { MAX_SCAN_BYTES, type SecretFinding, isLocalEnvFile, scanSecrets } from "@brain/core";
import { CliError, EXIT } from "./api";

// FEAT-015: scans changed files for secrets on this machine. Prints masked findings only (file, line, type, first 4
// characters + ***): no source line and no secret value is printed or sent anywhere (D-002, AC-015-03). The agent
// passes the output to generate_receipt as secretFindings.
export const MAX_SCAN_FILES = 500;

export type Git = (args: string[], cwd: string) => Promise<string>;
export const runGit: Git = (args, cwd) =>
  new Promise((done, fail) => {
    execFile("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      err ? fail(err) : done(stdout),
    );
  });

// git -z output: NUL-separated, never quoted or escaped (names with spaces, quotes or non-ASCII stay as they are).
const names = (out: string) => out.split("\0").filter((l) => l.length > 0);

async function repoRoot(git: Git, cwd: string): Promise<string> {
  try {
    return (await git(["rev-parse", "--show-toplevel"], cwd)).trim();
  } catch {
    throw new CliError(
      EXIT.usage,
      "Not a git repository: pass the files to scan, or run it in the repo.",
    );
  }
}

// The changed files, root-relative: tracked changes against HEAD (or against --since, for changes already committed)
// plus new untracked files that are not ignored.
async function changedFiles(git: Git, root: string, since: string | undefined): Promise<string[]> {
  const base = since ?? "HEAD";
  const tracked = await git(["diff", "--name-only", "-z", "--no-renames", base, "--"], root).catch(
    () => {
      if (since) throw new CliError(EXIT.usage, "--since must name a commit of this repository.");
      // A repo without commits has no HEAD yet: compare the staged files instead.
      return git(["diff", "--name-only", "-z", "--no-renames", "--cached", "--"], root);
    },
  );
  const untracked = await git(["ls-files", "-z", "--others", "--exclude-standard"], root);
  return [...new Set([...names(tracked), ...names(untracked)])];
}

// A local .env is normally git-ignored and is where secrets belong; one that git tracks is committed, so it is scanned.
async function isTracked(git: Git, root: string, file: string): Promise<boolean> {
  return git(["ls-files", "--error-unmatch", "--", file], root).then(
    () => true,
    () => false,
  );
}

export type ScanReport = {
  findings: SecretFinding[];
  // Findings beyond MAX_REPORTED_FINDINGS (what generate_receipt accepts); pass it as secretFindingsOmitted.
  omitted: number;
  scanned: number;
  skipped: { file: string; reason: string }[];
};
export const MAX_REPORTED_FINDINGS = 200;

export async function runScanSecrets(
  args: string[],
  cwd: string,
  print: (line: string) => void,
  git: Git = runGit,
): Promise<number> {
  const at = args.indexOf("--since");
  let since: string | undefined;
  if (at !== -1) {
    since = args[at + 1];
    // A value starting with "-" would be read by git as an option.
    if (!since || since.startsWith("-")) {
      throw new CliError(EXIT.usage, "--since needs a commit, e.g. --since HEAD~1");
    }
    args.splice(at, 2);
  }
  let root: string;
  let files: string[];
  if (args.length > 0) {
    if (since) throw new CliError(EXIT.usage, "Use --since or name files, not both.");
    // Named files: paths relative to the repo root (as receipts use them), or to this folder outside git.
    root = await repoRoot(git, cwd).catch(() => cwd);
    files = args.map((a) => relative(root, resolve(cwd, a)).split(sep).join("/"));
  } else {
    root = await repoRoot(git, cwd);
    files = await changedFiles(git, root, since);
  }
  const realRoot = await realpath(root);
  const report: ScanReport = { findings: [], omitted: 0, scanned: 0, skipped: [] };
  const all: SecretFinding[] = [];
  for (const [i, file] of files.entries()) {
    if (i >= MAX_SCAN_FILES) {
      report.skipped.push({ file, reason: `more than ${MAX_SCAN_FILES} files` });
      continue;
    }
    const abs = join(root, file);
    // The real path must stay inside the repo: no ../, absolute paths or symlinked folders that lead outside.
    const real = await realpath(abs).catch(() => null);
    if (file.startsWith("../") || isAbsolute(file) || (real && !real.startsWith(realRoot + sep))) {
      report.skipped.push({ file, reason: "outside this folder" });
      continue;
    }
    const st = await lstat(abs).catch(() => null);
    // A file deleted by the change has nothing to scan.
    if (!st) continue;
    // Folders and symlinks (which could point outside the repo) are not read.
    if (!st.isFile()) {
      report.skipped.push({ file, reason: st.isSymbolicLink() ? "symlink" : "not a file" });
      continue;
    }
    if (st.size > MAX_SCAN_BYTES) {
      report.skipped.push({ file, reason: "larger than 1 MB" });
      continue;
    }
    const text = await readFile(abs, "utf8").catch(() => null);
    if (text === null) {
      report.skipped.push({ file, reason: "cannot be read" });
      continue;
    }
    if (text.includes("\0")) continue;
    report.scanned++;
    const scanLocalEnv = isLocalEnvFile(file) && (await isTracked(git, root, file));
    all.push(...scanSecrets(file, text, { scanLocalEnv }));
  }
  report.findings = all.slice(0, MAX_REPORTED_FINDINGS);
  report.omitted = Math.max(0, all.length - MAX_REPORTED_FINDINGS);
  print(JSON.stringify(report));
  return EXIT.ok;
}
