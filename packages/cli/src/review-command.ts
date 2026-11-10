import { isAbsolute } from "node:path";
import { type GuardFile, maintainabilityFlags, reviewChecklist } from "@brain/core";
import { CliError, EXIT } from "./api";
import {
  MAX_FILES,
  PARALLEL,
  SOURCE_NAME,
  type Source,
  changed,
  ciBase,
  readFile,
} from "./guard-command";
import { type Git, repoRoot } from "./scan-secrets";

// Roadmap Phase 7: `codeceipt review`. The build checklist for the changed files: which rules this change touches,
// with what to check, and maintainability flags (long files, large changes). Runs on this machine; nothing is sent
// and nothing is blocked. The /codeceipt-review workflow in the agent plugins runs it.
const USAGE = "Usage: codeceipt review [--staged | --ci [--base <branch>]] [--json]";

export type ReviewDeps = {
  git: Git;
  cwd: string;
  stdout: (line: string) => void;
  env?: Record<string, string | undefined>;
};

function parse(args: string[]) {
  const rest = [...args];
  const take = (name: string) => {
    const i = rest.indexOf(name);
    if (i === -1) return false;
    rest.splice(i, 1);
    return true;
  };
  const staged = take("--staged");
  const ci = take("--ci");
  const json = take("--json");
  let base: string | undefined;
  const i = rest.indexOf("--base");
  if (i !== -1) {
    base = rest[i + 1];
    // A value starting with "-" would be read by git as an option.
    if (!base || base.startsWith("-")) throw new CliError(EXIT.usage, USAGE);
    rest.splice(i, 2);
  }
  if (rest.length > 0 || (staged && ci) || (base && !ci)) throw new CliError(EXIT.usage, USAGE);
  return { staged, ci, json, base };
}

export async function runReview(args: string[], deps: ReviewDeps): Promise<number> {
  const opts = parse(args);
  const root = await repoRoot(deps.git, deps.cwd);
  const source: Source = opts.staged
    ? { kind: "staged" }
    : opts.ci
      ? { kind: "ci", base: opts.base ?? ciBase(deps.env) }
      : { kind: "worktree" };
  const { files, base } = await changed(deps.git, root, source);
  const safe = files.filter((f) => !f.startsWith("../") && !isAbsolute(f));
  const read = safe.slice(0, MAX_FILES);
  const loaded: GuardFile[] = [];
  for (let i = 0; i < read.length; i += PARALLEL) {
    const chunk = read.slice(i, i + PARALLEL);
    loaded.push(
      ...(await Promise.all(chunk.map((f) => readFile(deps.git, root, f, source, base)))),
    );
  }
  const items = reviewChecklist(loaded);
  const flags = maintainabilityFlags(loaded);
  if (opts.json) {
    deps.stdout(
      JSON.stringify({
        source: source.kind,
        files: files.length,
        truncated: safe.length > MAX_FILES,
        checklist: items.map(({ id, title, check, files: f }) => ({ id, title, check, files: f })),
        maintainability: flags,
      }),
    );
    return EXIT.ok;
  }
  const n = files.length;
  deps.stdout(
    `Codeceipt review: ${n} changed file${n === 1 ? "" : "s"} (${SOURCE_NAME[source.kind]}).`,
  );
  if (n === 0) return EXIT.ok;
  if (flags.length > 0) {
    deps.stdout("Maintainability:");
    for (const f of flags) deps.stdout(`  ! ${f.file ? `${f.file}: ` : ""}${f.what}`);
  }
  if (items.length === 0) {
    deps.stdout("No build-checklist rule applies to these files.");
  } else {
    deps.stdout("Check these before you call it done (docs/build-checklist.md):");
    for (const item of items) {
      deps.stdout(`  [ ] ${item.id}. ${item.title}`);
      deps.stdout(`      ${item.check}`);
      deps.stdout(`      Files: ${item.files.join(", ")}`);
    }
  }
  if (safe.length > MAX_FILES) deps.stdout(`Only the first ${MAX_FILES} files were read.`);
  deps.stdout("A checklist, not a verdict: nothing was sent and nothing was blocked.");
  return EXIT.ok;
}
