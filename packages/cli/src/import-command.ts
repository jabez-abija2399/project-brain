import { isAbsolute } from "node:path";
import {
  IMPORT_SOURCES,
  type ImportFile,
  type ImportSource,
  MAX_IMPORT_FILES,
  MAX_IMPORT_FILE_CHARS,
  importFeatures,
  importPathMatches,
  safeDisplay,
} from "@brain/core";
import { CliError, EXIT, request } from "./api";
import type { CliConfig } from "./config";
import { readFile } from "./guard-command";
import { type Git, repoRoot } from "./scan-secrets";

// Roadmap Phase 8: `codeceipt import`. Reads an existing spec on this machine (the AI Build Kit's
// agent/features.json, Spec Kit, Kiro, OpenSpec, AGENTS.md / CLAUDE.md rules, a README's feature list) and sends only
// what it describes: feature names, short criterion texts, file and line. The server saves it as the project's plan
// draft; nothing is active until the owner approves it on the Plan tab. --dry-run shows it and sends nothing.
const USAGE = `Usage: codeceipt import [--from ${IMPORT_SOURCES.join("|")}] [--dry-run] [--replace]`;

export type ImportDeps = {
  git: Git;
  cwd: string;
  stdout: (line: string) => void;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  config: () => Promise<CliConfig>;
};

function parse(args: string[]) {
  const rest = [...args];
  const take = (name: string) => {
    const at = rest.indexOf(name);
    if (at !== -1) rest.splice(at, 1);
    return at !== -1;
  };
  const dryRun = take("--dry-run");
  const replace = take("--replace");
  let from: ImportSource | undefined;
  const i = rest.indexOf("--from");
  if (i !== -1) {
    const v = rest[i + 1];
    if (!v || !(IMPORT_SOURCES as readonly string[]).includes(v))
      throw new CliError(EXIT.usage, USAGE);
    from = v as ImportSource;
    rest.splice(i, 2);
  }
  if (rest.length > 0) throw new CliError(EXIT.usage, USAGE);
  return { from, dryRun, replace };
}

export async function runImport(args: string[], deps: ImportDeps): Promise<number> {
  const opts = parse(args);
  const root = await repoRoot(deps.git, deps.cwd);
  // Tracked and new (not ignored) files; read like Guard reads them: inside the repo only, no symlinks, 1 MB at most.
  const listed = (
    await deps.git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root)
  )
    .split("\0")
    .filter((p) => p.length > 0 && !p.startsWith("../") && !isAbsolute(p));
  const bySource = new Map<ImportSource, string[]>();
  for (const s of IMPORT_SOURCES) {
    const paths = listed.filter((p) => importPathMatches(s, p)).slice(0, MAX_IMPORT_FILES);
    if (paths.length > 0) bySource.set(s, paths);
  }
  const source = opts.from ?? (bySource.size === 1 ? [...bySource.keys()][0] : undefined);
  if (!source) {
    deps.stdout(
      bySource.size === 0
        ? "Nothing to import: no agent/features.json, specs/*/spec.md, .kiro/specs, openspec/specs, AGENTS.md, CLAUDE.md or README.md here."
        : `Found more than one kind of spec: ${[...bySource.keys()].join(", ")}. Pick one: codeceipt import --from <kind>.`,
    );
    return bySource.size === 0 ? EXIT.ok : EXIT.usage;
  }
  const paths = bySource.get(source) ?? [];
  if (paths.length === 0) {
    deps.stdout(`Nothing to import from ${source} in this repo.`);
    return EXIT.ok;
  }
  const files: ImportFile[] = [];
  for (const path of paths) {
    const f = await readFile(deps.git, root, path, { kind: "worktree" }, null);
    if (f.after !== null) files.push({ path, text: f.after.slice(0, MAX_IMPORT_FILE_CHARS) });
  }
  const features = importFeatures(source, files);
  const criteria = features.reduce((n, f) => n + f.items.length, 0);
  deps.stdout(
    `Codeceipt import (${source}): ${features.length} feature${features.length === 1 ? "" : "s"}, ${criteria} criteria from ${files.length} file${files.length === 1 ? "" : "s"}.`,
  );
  for (const f of features.slice(0, 20)) {
    deps.stdout(`  ${f.name} (${f.items.length}) ${f.path}:${f.line}`);
  }
  if (features.length > 20) deps.stdout(`  ...and ${features.length - 20} more`);
  if (features.length === 0) return EXIT.ok;
  if (opts.dryRun) {
    deps.stdout("Dry run: nothing was sent.");
    return EXIT.ok;
  }
  const config = await deps.config();
  const answer = await request<{
    draft_id: string | null;
    features: number;
    criteria: number;
    skipped: string[];
    more: number;
    cut_items: number;
  }>(deps.fetch, config, "POST", `/api/hooks/${encodeURIComponent(config.projectId)}/import`, {
    source,
    features,
    ...(opts.replace ? { replace: true } : {}),
  });
  // Numbers from the server are printed as numbers only (a wrong api URL cannot write into the terminal).
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;
  if (Array.isArray(answer.skipped) && answer.skipped.length > 0) {
    deps.stdout(
      `Already in the project, not imported again: ${answer.skipped.map((s) => safeDisplay(s, 100)).join(", ")}.`,
    );
  }
  if (!answer.draft_id) {
    deps.stdout("Nothing new to import.");
    return EXIT.ok;
  }
  const page = `${config.apiUrl.replace(/\/+$/, "")}/projects/${encodeURIComponent(config.projectId)}/plan`;
  deps.stdout(
    `Saved as a draft: ${n(answer.features)} features, ${n(answer.criteria)} criteria. Nothing is active yet.`,
  );
  if (n(answer.cut_items) > 0)
    deps.stdout(
      `${n(answer.cut_items)} criteria were left out (at most 8 per feature in one draft).`,
    );
  if (n(answer.more) > 0)
    deps.stdout(
      `${n(answer.more)} more features: approve this draft, then run codeceipt import again.`,
    );
  deps.stdout(`The project owner reviews and approves it here: ${page}`);
  return EXIT.ok;
}
