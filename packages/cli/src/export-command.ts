import {
  constants,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import {
  EXPORT_TARGETS,
  type ExportBlueprint,
  type ExportTarget,
  agentsSection,
  isGenerated,
  mergeAgents,
  specFiles,
} from "@brain/core";
import { CliError, EXIT, request } from "./api";
import type { CliConfig } from "./config";
import { type Git, repoRoot } from "./scan-secrets";

// Roadmap Phase 8: `codeceipt export`. Writes the owner-approved Blueprint into the repo: a managed section of
// AGENTS.md (everything outside it is kept), or OpenSpec / Spec Kit spec files. Without --write it only says what would
// change; --check fails when the files are out of date (for CI). It never overwrites a file it did not write, never
// writes outside the repo and never follows a symlink.
const USAGE = `Usage: codeceipt export --to ${EXPORT_TARGETS.join("|")} [--write | --check]`;
const MAX_READ = 1024 * 1024;

export type ExportDeps = {
  git: Git;
  cwd: string;
  stdout: (line: string) => void;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  config: () => Promise<CliConfig>;
};

type Current = { state: "missing" } | { state: "file"; text: string } | { state: "unsafe" };

function parse(args: string[]) {
  const rest = [...args];
  const take = (name: string) => {
    const at = rest.indexOf(name);
    if (at !== -1) rest.splice(at, 1);
    return at !== -1;
  };
  const write = take("--write");
  const check = take("--check");
  const i = rest.indexOf("--to");
  const to = i === -1 ? undefined : rest[i + 1];
  if (i !== -1) rest.splice(i, 2);
  if (
    !to ||
    !(EXPORT_TARGETS as readonly string[]).includes(to) ||
    rest.length > 0 ||
    (write && check)
  )
    throw new CliError(EXIT.usage, USAGE);
  return { to: to as ExportTarget, write, check };
}

/** What is at a repo-relative path, without following any symlink on the way. */
function inspect(root: string, rel: string): Current {
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return { state: "unsafe" };
  let path = root;
  for (const [i, part] of parts.entries()) {
    path = join(path, part);
    const st = lstatSync(path, { throwIfNoEntry: false });
    if (!st) return { state: "missing" };
    if (st.isSymbolicLink()) return { state: "unsafe" };
    const last = i === parts.length - 1;
    if (!last && !st.isDirectory()) return { state: "unsafe" };
    if (last) {
      if (!st.isFile() || st.size > MAX_READ) return { state: "unsafe" };
      return { state: "file", text: readFileSync(path, "utf8") };
    }
  }
  return { state: "unsafe" };
}

/** Writes one file inside the repo: parents made one at a time (never through a symlink), the file opened no-follow. */
function writeInside(root: string, rel: string, text: string, create: boolean) {
  const parts = rel.split("/");
  let dir = root;
  for (const part of parts.slice(0, -1)) {
    dir = join(dir, part);
    const st = lstatSync(dir, { throwIfNoEntry: false });
    if (!st) mkdirSync(dir);
    const now = lstatSync(dir);
    if (now.isSymbolicLink() || !now.isDirectory())
      throw new CliError(EXIT.failure, `Not written: ${rel} (a folder on the way is a link).`);
  }
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const flags = create
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow
    : constants.O_WRONLY | constants.O_TRUNC | noFollow;
  const fd = openSync(join(root, rel), flags, 0o644);
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

export async function runExport(args: string[], deps: ExportDeps): Promise<number> {
  const opts = parse(args);
  const root = await repoRoot(deps.git, deps.cwd);
  const config = await deps.config();
  const bp = await request<ExportBlueprint & { ready: boolean }>(
    deps.fetch,
    config,
    "GET",
    `/api/hooks/${encodeURIComponent(config.projectId)}/blueprint`,
  );
  if (!bp.ready || !Array.isArray(bp.features) || !Array.isArray(bp.boundaries)) {
    deps.stdout("The Blueprint is not set up on the server yet, so there is nothing to export.");
    return EXIT.ok;
  }
  const planned = new Map<string, string | null>();
  let broken = false;
  if (opts.to === "agents") {
    const current = inspect(root, "AGENTS.md");
    const merged =
      current.state === "unsafe"
        ? null
        : mergeAgents(current.state === "file" ? current.text : null, agentsSection(bp));
    if (current.state !== "unsafe" && merged === null) broken = true;
    planned.set("AGENTS.md", merged);
  } else {
    for (const [path, text] of specFiles(opts.to, bp)) planned.set(path, text);
  }
  const changes: { path: string; text: string; create: boolean }[] = [];
  const kept: string[] = [];
  for (const [path, text] of planned) {
    const current = inspect(root, path);
    if (text === null || current.state === "unsafe") {
      kept.push(
        `${path} (${broken ? "its Codeceipt markers are broken; fix or remove them" : "a link or not a plain file"})`,
      );
    } else if (current.state === "missing") changes.push({ path, text, create: true });
    else if (current.text === text) continue;
    else if (opts.to === "agents" || isGenerated(current.text))
      changes.push({ path, text, create: false });
    else kept.push(`${path} (written by hand; left as it is)`);
  }
  for (const c of changes) deps.stdout(`  ${c.create ? "create" : "update"} ${c.path}`);
  for (const k of kept) deps.stdout(`  keep   ${k}`);
  const n = bp.features.length;
  if (changes.length === 0) {
    deps.stdout(
      `Codeceipt export (${opts.to}): up to date with Blueprint version ${Math.trunc(Number(bp.version)) || 0} (${n} feature${n === 1 ? "" : "s"}).`,
    );
    return EXIT.ok;
  }
  if (opts.check) {
    deps.stdout(
      `Codeceipt export (${opts.to}): ${changes.length} file${changes.length === 1 ? " is" : "s are"} out of date. Run codeceipt export --to ${opts.to} --write.`,
    );
    return EXIT.failure;
  }
  if (!opts.write) {
    deps.stdout(
      `Codeceipt export (${opts.to}): ${changes.length} file${changes.length === 1 ? "" : "s"} would change. Add --write to write them.`,
    );
    return EXIT.ok;
  }
  for (const c of changes) writeInside(root, c.path, c.text, c.create);
  deps.stdout(
    `Codeceipt export (${opts.to}): wrote ${changes.length} file${changes.length === 1 ? "" : "s"}. Review them and commit.`,
  );
  return EXIT.ok;
}
