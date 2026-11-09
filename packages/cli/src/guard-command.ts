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

/** The before and after text of one changed file; binary files have none, files over 1 MB are only named. */
async function readFile(git: Git, root: string, path: string, source: Source, base: string | null) {
  // "<commit>:./<path>" and ":./<path>" (the staged copy): git reads them from its objects, never from a path outside.
  const beforeSpec = base ? `${base}:./${path}` : null;
  const before = beforeSpec ? await show(git, root, beforeSpec) : null;
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
    if (!st?.isFile() || !real || !real.startsWith(realpathSync(root) + sep)) after = null;
    else if (st.size > MAX_SCAN_BYTES) return { path, before: null, after: null, tooLarge: true };
    else {
      try {
        after = readFileSync(abs, "utf8");
      } catch {
        after = null;
      }
    }
  } else {
    after = await show(git, root, source.kind === "staged" ? `:./${path}` : `HEAD:./${path}`);
  }
  if ((after?.length ?? 0) > MAX_SCAN_BYTES)
    return { path, before: null, after: null, tooLarge: true };
  const text = (t: string | null) =>
    t !== null && !t.includes("\0") && t.length <= MAX_SCAN_BYTES ? t : null;
  return { path, before: text(before), after: text(after) };
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
    const list = validBoundaries(res.boundaries);
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
  const [loaded, bounds] = await Promise.all([
    (async () => {
      const out: GuardFile[] = [];
      const safe = files.filter((f) => !f.startsWith("../") && !isAbsolute(f)).slice(0, MAX_FILES);
      for (let i = 0; i < safe.length; i += PARALLEL) {
        const chunk = safe.slice(i, i + PARALLEL);
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
  const findings = guardCheck({ files: loaded, dependencies, boundaries: bounds });
  if (opts.json) {
    deps.stdout(
      JSON.stringify({
        mode,
        source: source.kind,
        files: files.length,
        boundaries_checked: bounds !== null,
        findings,
      }),
    );
  } else {
    for (const line of report(findings, files.length, mode, bounds !== null, source))
      deps.stdout(line);
    if (files.length > MAX_FILES)
      deps.stdout(`  Only the first ${MAX_FILES} changed files were checked.`);
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
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${HOOK_MARK}\n${line}\n`, { flag: "wx", mode: 0o755 });
  chmodSync(file, 0o755);
  deps.stdout("Codeceipt Guard now checks every commit in this repo (a pre-commit hook).");
  deps.stdout(
    "  Problems block the commit in strict mode; `codeceipt config guard gentle` only reports them.",
  );
  return EXIT.ok;
}
