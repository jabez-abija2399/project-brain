import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { MAX_SCAN_BYTES, type SecretFinding, scanSecrets } from "@brain/core";
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

const lines = (out: string) => out.split("\n").filter((l) => l.length > 0);

// The repo root, and the changed files there (tracked changes against HEAD plus new untracked files), root-relative.
async function changedFiles(git: Git, cwd: string): Promise<{ root: string; files: string[] }> {
  let root: string;
  try {
    root = (await git(["rev-parse", "--show-toplevel"], cwd)).trim();
  } catch {
    throw new CliError(
      EXIT.usage,
      "Not a git repository: pass the files to scan, or run it in the repo.",
    );
  }
  const tracked = await git(["diff", "--name-only", "--no-renames", "HEAD"], root).catch(() =>
    git(["diff", "--name-only", "--no-renames", "--cached"], root),
  );
  const untracked = await git(["ls-files", "--others", "--exclude-standard"], root);
  return { root, files: [...new Set([...lines(tracked), ...lines(untracked)])] };
}

export type ScanReport = {
  findings: SecretFinding[];
  scanned: number;
  skipped: { file: string; reason: string }[];
};

export async function runScanSecrets(
  args: string[],
  cwd: string,
  print: (line: string) => void,
  git: Git = runGit,
): Promise<number> {
  let root = cwd;
  let files: string[];
  if (args.length > 0) {
    // Named files: paths relative to the repo root (as receipts use them), or to this folder outside git.
    root = (await git(["rev-parse", "--show-toplevel"], cwd).catch(() => cwd)).trim();
    files = args.map((a) => relative(root, resolve(cwd, a)).split(sep).join("/"));
  } else {
    ({ root, files } = await changedFiles(git, cwd));
  }
  const report: ScanReport = { findings: [], scanned: 0, skipped: [] };
  for (const [i, file] of files.entries()) {
    if (i >= MAX_SCAN_FILES) {
      report.skipped.push({ file, reason: `more than ${MAX_SCAN_FILES} files` });
      continue;
    }
    if (file.startsWith("../") || isAbsolute(file)) {
      report.skipped.push({ file, reason: "outside this folder" });
      continue;
    }
    const abs = join(root, file);
    const st = await lstat(abs).catch(() => null);
    // Deleted files, folders and symlinks (which could point outside the repo) are not read.
    if (!st?.isFile()) continue;
    if (st.size > MAX_SCAN_BYTES) {
      report.skipped.push({ file, reason: "larger than 1 MB" });
      continue;
    }
    const text = await readFile(abs, "utf8").catch(() => null);
    if (text === null || text.includes("\0")) continue;
    report.scanned++;
    report.findings.push(...scanSecrets(file, text));
  }
  print(JSON.stringify(report));
  return EXIT.ok;
}
