import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
  type GuardFile,
  type GuardFinding,
  MAX_SCAN_BYTES,
  guardCheck,
  newPackageNames,
} from "@brain/core";
import { CliError, EXIT, request } from "./api";
import type { CliConfig } from "./config";
import {
  type Boundary,
  gitDirOf,
  readBoundaryCache,
  validBoundaries,
  writeBoundaryCache,
} from "./repo-link";
import { type Git, changedFiles, repoRoot } from "./scan-secrets";
import { shellHook } from "./templates";

// Roadmap Phase 5: `codeceipt guard`. Checks only the changed files, on this machine, before a commit (--staged, the
// pre-commit hook) or a merge (--ci): weakened tests, new secrets, hidden or lookalike characters, paths and packages
// the owner's Blueprint does not allow, and files too large to review. Nothing is uploaded; the Blueprint's boundaries
// are read from the server (and kept for offline use). Modes: strict (problems fail the command), gentle (reported
// only), off.
export type GuardMode = "strict" | "gentle" | "off";
export const GUARD_MODES = new Set<GuardMode>(["strict", "gentle", "off"]);
const USAGE =
  "Usage: codeceipt guard [--staged | --ci [--base <branch>]] [--mode strict|gentle|off] [--json] | codeceipt guard --install-hook";
const MAX_FILES = 500;
const BOUNDARY_TIMEOUT_MS = 1500;
const PARALLEL = 16;
const HOOK_MARK = "# Codeceipt Guard (written by codeceipt guard --install-hook)";

export type GuardDeps = {
  git: Git;
  cwd: string;
  stdout: (line: string) => void;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** The repo's project and token; rejects when the repo is not linked (boundaries are then not checked). */
  config: () => Promise<CliConfig>;
  /** The mode from `codeceipt config guard` (strict when nothing is set). */
  savedMode: GuardMode;
  env?: Record<string, string | undefined>;
};

type Source = { kind: "staged" } | { kind: "ci"; base: string } | { kind: "worktree" };

function parse(args: string[]) {
  const rest = [...args];
  const take = (name: string) => {
    const i = rest.indexOf(name);
    if (i === -1) return false;
    rest.splice(i, 1);
    return true;
  };
  const value = (name: string) => {
    const i = rest.indexOf(name);
    if (i === -1) return undefined;
    const v = rest[i + 1];
    // A value starting with "-" would be read by git as an option.
    if (!v || v.startsWith("-")) throw new CliError(EXIT.usage, USAGE);
    rest.splice(i, 2);
    return v;
  };
  const install = take("--install-hook");
  const staged = take("--staged");
  const ci = take("--ci");
  const json = take("--json");
  const base = value("--base");
  const mode = value("--mode");
  if (rest.length > 0 || (staged && ci) || (base && !ci) || (install && args.length > 1)) {
    throw new CliError(EXIT.usage, USAGE);
  }
  if (mode !== undefined && !GUARD_MODES.has(mode as GuardMode))
    throw new CliError(EXIT.usage, USAGE);
  return { install, staged, ci, json, base, mode: mode as GuardMode | undefined };
}

const show = (git: Git, root: string, spec: string) =>
  git(["show", spec], root).then(
    (t) => t,
    () => null,
  );
// The object's size, before reading it (a file larger than git's read buffer would otherwise fail unseen); null when
// the path does not exist in that version.
const sizeOf = (git: Git, root: string, spec: string) =>
  git(["cat-file", "-s", spec], root).then(
    (o) => Number.parseInt(o.trim(), 10),
    () => null,
  );

// Files that are binary by kind (images, fonts, archives, media) are not read as text; anything else with a NUL byte
// is still scanned (JavaScript allows NUL in strings and comments, so it is no reason to skip a file).
const BINARY =
  /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|woff2?|ttf|otf|eot|mp[34]|m4a|mov|webm|ogg|wav|flac|wasm)$/i;

/** The before and after text of one changed file; binary files have none, files over 1 MB are only named. */
async function readFile(
  git: Git,
  root: string,
  path: string,
  source: Source,
  base: string | null,
): Promise<GuardFile> {
  if (BINARY.test(path)) return { path, before: null, after: null, binary: true };
  // "<commit>:./<path>" and ":./<path>" (the staged copy): git reads them from its objects, never from a path outside.
  const beforeSpec = base ? `${base}:./${path}` : null;
  const beforeSize = beforeSpec ? await sizeOf(git, root, beforeSpec) : null;
  if (beforeSize !== null && beforeSize > MAX_SCAN_BYTES) {
    return { path, before: null, after: null, tooLarge: true };
  }
  const before = beforeSpec && beforeSize !== null ? await show(git, root, beforeSpec) : null;
  if (beforeSize !== null && before === null)
    return { path, before: null, after: null, unreadable: true };
  let after: string | null;
  if (source.kind === "worktree") {
    const abs = join(root, path);
    // The real path must stay inside the repo (a symlinked folder could lead outside); symlinks are not read.
    const real = (() => {
      try {
        return realpathSync(abs);
      } catch {
        return null;
      }
    })();
    const st = lstatSync(abs, { throwIfNoEntry: false });
    if (!st) after = null;
    else if (!st.isFile() || !real || !real.startsWith(realpathSync(root) + sep)) {
      return { path, before: null, after: null, unreadable: true };
    } else if (st.size > MAX_SCAN_BYTES) return { path, before: null, after: null, tooLarge: true };
    else {
      try {
        after = readFileSync(abs, "utf8");
      } catch {
        return { path, before: null, after: null, unreadable: true };
      }
    }
  } else {
    const spec = source.kind === "staged" ? `:./${path}` : `HEAD:./${path}`;
    const size = await sizeOf(git, root, spec);
    if (size !== null && size > MAX_SCAN_BYTES)
      return { path, before: null, after: null, tooLarge: true };
    after = size === null ? null : await show(git, root, spec);
    if (size !== null && after === null)
      return { path, before: null, after: null, unreadable: true };
  }
  if ((after?.length ?? 0) > MAX_SCAN_BYTES)
    return { path, before: null, after: null, tooLarge: true };
  return { path, before, after };
}

async function changed(
  git: Git,
  root: string,
  source: Source,
): Promise<{ files: string[]; base: string | null }> {
  const list = (out: string) => out.split("\0").filter((l) => l.length > 0);
  const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"], root).then(
    (o) => o.trim(),
    () => null,
  );
  if (source.kind === "staged") {
    const out = await git(["diff", "--cached", "--name-only", "-z", "--no-renames", "--"], root);
    return { files: list(out), base: head };
  }
  if (source.kind === "ci") {
    const mergeBase = await git(["merge-base", source.base, "HEAD"], root).then(
      (o) => o.trim(),
      () => {
        throw new CliError(
          EXIT.usage,
          `--base must name a branch or commit this repo has (${source.base} was not found).`,
        );
      },
    );
    const out = await git(
      ["diff", "--name-only", "-z", "--no-renames", mergeBase, "HEAD", "--"],
      root,
    );
    return { files: list(out), base: mergeBase };
  }
  return { files: await changedFiles(git, root, undefined), base: head };
}

/** The Blueprint's active boundaries: from the server when it answers, else the last ones kept; null when neither. */
async function boundaries(deps: GuardDeps, gitDir: string | null): Promise<Boundary[] | null> {
  const config = await deps.config().catch(() => null);
  if (!config) return null;
  try {
    const res = await request<{ ready?: unknown; boundaries?: unknown }>(
      (url, init) => deps.fetch(url, { ...init, signal: AbortSignal.timeout(BOUNDARY_TIMEOUT_MS) }),
      config,
      "GET",
      `/api/hooks/${encodeURIComponent(config.projectId)}/boundaries`,
    );
    // Before migration 0054 the server answers "not ready": the boundaries are unknown, not empty.
    const list = res.ready === true ? validBoundaries(res.boundaries) : null;
    if (list) {
      if (gitDir) writeBoundaryCache(gitDir, config.projectId, list);
      return list;
    }
  } catch {
    // Offline or a slow server: the last boundaries kept for this project.
  }
  return gitDir ? readBoundaryCache(gitDir, config.projectId) : null;
}

const SOURCE_NAME = {
  staged: "staged changes",
  ci: "changes on this branch",
  worktree: "uncommitted changes",
};

function report(
  findings: GuardFinding[],
  files: number,
  mode: GuardMode,
  checked: boolean,
  source: Source,
) {
  const lines: string[] = [];
  const what = `${files} changed file${files === 1 ? "" : "s"} (${SOURCE_NAME[source.kind]})`;
  if (findings.length === 0) lines.push(`Codeceipt Guard: no problems in ${what}.`);
  else {
    lines.push(
      `Codeceipt Guard: ${findings.length} problem${findings.length === 1 ? "" : "s"} in ${what}.`,
    );
    for (const f of findings) {
      lines.push(`  ✗ ${f.file}${f.line ? `:${f.line}` : ""}: ${f.what}`);
      lines.push(`    Fix: ${f.fix}`);
    }
  }
  if (!checked) {
    lines.push(
      "  Blueprint boundaries were not checked: this repo is not linked, or the server could not be reached.",
    );
  }
  if (findings.length > 0) {
    lines.push(
      mode === "strict"
        ? "Fix the problems above, then try again."
        : "Gentle mode: nothing was blocked (`codeceipt config guard strict` blocks commits with problems).",
    );
  }
  return lines;
}

export async function runGuard(args: string[], deps: GuardDeps): Promise<number> {
  const opts = parse(args);
  const root = await repoRoot(deps.git, deps.cwd);
  if (opts.install) return installHook(deps, root);
  const mode = opts.mode ?? deps.savedMode;
  if (mode === "off") {
    deps.stdout(
      opts.json
        ? JSON.stringify({ mode, findings: [] })
        : "Codeceipt Guard is off (`codeceipt config guard strict` turns it on).",
    );
    return EXIT.ok;
  }
  const source: Source = opts.staged
    ? { kind: "staged" }
    : opts.ci
      ? { kind: "ci", base: opts.base ?? ciBase(deps) }
      : { kind: "worktree" };
  const { files, base } = await changed(deps.git, root, source);
  const gitDir = await gitDirOf(deps.git, root);
  const safe = files.filter((f) => !f.startsWith("../") && !isAbsolute(f));
  const [loaded, bounds] = await Promise.all([
    (async () => {
      const out: GuardFile[] = [];
      const read = safe.slice(0, MAX_FILES);
      for (let i = 0; i < read.length; i += PARALLEL) {
        const chunk = read.slice(i, i + PARALLEL);
        out.push(
          ...(await Promise.all(chunk.map((f) => readFile(deps.git, root, f, source, base)))),
        );
      }
      return out;
    })(),
    boundaries(deps, gitDir),
  ]);
  const dependencies = loaded
    .filter((f) => f.path === "package.json" || f.path.endsWith("/package.json"))
    .flatMap((f) => newPackageNames(f.before, f.after));
  // Every changed path is checked against the boundaries (paths only); a change too large to read in full fails.
  const findings = guardCheck({
    files: loaded,
    paths: safe,
    unreadFiles: Math.max(0, safe.length - MAX_FILES),
    dependencies,
    boundaries: bounds,
  });
  if (opts.json) {
    deps.stdout(
      JSON.stringify({
        mode,
        source: source.kind,
        files: files.length,
        truncated: safe.length > MAX_FILES,
        boundaries_checked: bounds !== null,
        findings,
      }),
    );
  } else {
    for (const line of report(findings, files.length, mode, bounds !== null, source))
      deps.stdout(line);
  }
  return findings.length > 0 && mode === "strict" ? EXIT.failure : EXIT.ok;
}

// GitHub Actions names the pull request's target branch; elsewhere the default is origin/main.
function ciBase(deps: GuardDeps): string {
  const ref = deps.env?.GITHUB_BASE_REF;
  return ref && /^[A-Za-z0-9._/-]{1,200}$/.test(ref) && !ref.startsWith("-")
    ? `origin/${ref}`
    : "origin/main";
}

/**
 * `codeceipt guard --install-hook`: writes the repo's pre-commit hook, only when there is none (an existing hook is
 * never changed: the line to add is printed instead). Only ever run because the user asked (here or at setup).
 */
export async function installHook(
  deps: Pick<GuardDeps, "git" | "stdout">,
  root: string,
): Promise<number> {
  const rel = (await deps.git(["rev-parse", "--git-path", "hooks"], root)).trim();
  const dir = resolve(root, rel);
  const file = join(dir, "pre-commit");
  const line = shellHook("codeceipt guard --staged");
  if (existsSync(file) || lstatSync(file, { throwIfNoEntry: false })) {
    const ours = (() => {
      try {
        return readFileSync(file, "utf8").includes(HOOK_MARK);
      } catch {
        return false;
      }
    })();
    deps.stdout(
      ours
        ? "Codeceipt Guard already checks every commit in this repo."
        : `This repo already has a pre-commit hook (${file}); it was not changed. Add this line to it to check every commit:`,
    );
    if (!ours) deps.stdout("  codeceipt guard --staged");
    return EXIT.ok;
  }
  // Only inside this repo or its git folder: a global core.hooksPath (shared by every repo) or a symlinked hooks folder
  // that leads elsewhere gets the line to add instead.
  const gitDir = await gitDirOf(deps.git, root);
  const realRoot = realpathSync(root);
  const existing = (() => {
    let d = dir;
    while (!existsSync(d) && resolve(d, "..") !== d) d = resolve(d, "..");
    try {
      return realpathSync(d);
    } catch {
      return null;
    }
  })();
  const within = (r: string | null, top: string | null) =>
    r !== null && top !== null && (r === top || r.startsWith(top + sep));
  if (!within(existing, realRoot) && !within(existing, gitDir)) {
    deps.stdout(
      `This repo's hooks folder (${dir}) is outside the repo, so no hook was written. Add this line to its pre-commit hook:`,
    );
    deps.stdout("  codeceipt guard --staged");
    return EXIT.ok;
  }
  mkdirSync(dir, { recursive: true });
  if (!within(realpathSync(dir), realRoot) && !within(realpathSync(dir), gitDir)) {
    deps.stdout("This repo's hooks folder leads outside the repo, so no hook was written.");
    return EXIT.ok;
  }
  writeFileSync(file, `#!/bin/sh\n${HOOK_MARK}\n${line}\n`, { flag: "wx", mode: 0o755 });
  chmodSync(file, 0o755);
  deps.stdout("Codeceipt Guard now checks every commit in this repo (a pre-commit hook).");
  deps.stdout(
    "  Problems block the commit in strict mode; `codeceipt config guard gentle` only reports them.",
  );
  return EXIT.ok;
}
