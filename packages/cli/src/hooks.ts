import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { CliError, EXIT, request } from "./api";
import type { CliConfig } from "./config";
import { callTool } from "./mcp-client";
import { type Git, changedFiles, repoRoot, scanFiles } from "./scan-secrets";

// FEAT-016 agent hooks. They fail safe: whatever goes wrong (not logged in, server unreachable, git missing), the
// agent session goes on and the hook prints one short warning. Changed files always come from git, never from the
// agent.
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Agent = "claude" | "cursor";
export type HookDeps = {
  fetch: Fetch;
  git: Git;
  cwd: string;
  config: CliConfig | null;
  readStdin: () => Promise<string>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => Date;
};

const START_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 15_000;
const RECEIPT_TIMEOUT_MS = 40_000;
const MAX_STDIN = 64 * 1024;
const MAX_RECEIPT_FILES = 200;
const MAX_WARNED_ITEMS = 10;
const WARN = "Project Brain:";

const timed =
  (fetchImpl: Fetch, ms: number): Fetch =>
  (url, init) =>
    fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) });

async function hookInput(deps: HookDeps): Promise<{ sessionId: string; cwd: string }> {
  let raw: unknown = {};
  try {
    const text = await deps.readStdin();
    if (text.length <= MAX_STDIN) raw = JSON.parse(text);
  } catch {}
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const id = typeof input.session_id === "string" ? input.session_id : "";
  const roots = input.workspace_roots;
  const cwd =
    typeof input.cwd === "string" && isAbsolute(input.cwd)
      ? input.cwd
      : Array.isArray(roots) && typeof roots[0] === "string" && isAbsolute(roots[0])
        ? roots[0]
        : deps.cwd;
  // The id names a state file: anything but a plain id is hashed, so it cannot reach outside the state folder.
  const sessionId = /^[A-Za-z0-9_-]{1,128}$/.test(id)
    ? id
    : createHash("sha256")
        .update(id || "default")
        .digest("hex")
        .slice(0, 32);
  return { sessionId, cwd };
}

// The session's starting commit lives in the repo's .git folder (never committed), keyed by session id.
async function stateFile(git: Git, root: string, sessionId: string): Promise<string> {
  const gitDir = (await git(["rev-parse", "--absolute-git-dir"], root)).trim();
  return join(gitDir, "projectbrain", `session-${sessionId}.json`);
}

const head = (git: Git, root: string) =>
  git(["rev-parse", "--verify", "-q", "HEAD"], root).then(
    (out) => (/^[0-9a-f]{40,64}$/.test(out.trim()) ? out.trim() : null),
    () => null,
  );

/** Session start: remembers the starting commit and shows the handoff note from where_did_we_stop. */
export async function sessionStart(agent: Agent, deps: HookDeps): Promise<void> {
  const { sessionId, cwd } = await hookInput(deps);
  try {
    const root = await repoRoot(deps.git, cwd);
    const file = await stateFile(deps.git, root, sessionId);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify({ start: await head(deps.git, root) }));
  } catch {
    // Not a git repo: session end then compares with HEAD.
  }
  if (!deps.config)
    return deps.stderr(`${WARN} not logged in (run \`projectbrain login\`); no handoff note.`);
  let note: string;
  try {
    note = await callTool(
      timed(deps.fetch, START_TIMEOUT_MS),
      deps.config,
      "where_did_we_stop",
      {},
    );
  } catch {
    return deps.stderr(`${WARN} server unreachable; no handoff note this session.`);
  }
  // Claude Code adds plain stdout to the session; Cursor reads additional_context from JSON.
  deps.stdout(agent === "cursor" ? JSON.stringify({ additional_context: note }) : note);
}

type OpenItems = {
  requests: { id: string; text: string; items: { text: string; status: string }[] }[];
};

/**
 * Session end: takes the changed files from git (against the session's starting commit, plus untracked files), scans
 * them for secrets on this machine, asks for a receipt for the newest open request, saves progress and warns about
 * checklist items that are neither done nor parked. Returns true when there is something to warn about.
 */
export async function sessionEnd(_agent: Agent, deps: HookDeps): Promise<boolean> {
  const { sessionId, cwd } = await hookInput(deps);
  if (!deps.config) {
    deps.stderr(`${WARN} not logged in (run \`projectbrain login\`); progress was not saved.`);
    return true;
  }
  const config = deps.config;
  let root = cwd;
  let files: string[] = [];
  let start: string | null = null;
  let commit: string | null = null;
  try {
    root = await repoRoot(deps.git, cwd);
    const file = await stateFile(deps.git, root, sessionId);
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as { start?: unknown };
      if (typeof saved.start === "string" && /^[0-9a-f]{40,64}$/.test(saved.start))
        start = saved.start;
    } catch {}
    rmSync(file, { force: true });
    files = await changedFiles(deps.git, root, start ?? undefined);
    commit = await head(deps.git, root);
  } catch {
    // Not a git repo: no changed files can be known, so none are claimed.
  }
  const scan = await scanFiles(deps.git, root, files).catch(() => null);
  const base = `/api/hooks/${encodeURIComponent(config.projectId)}/open-items`;
  try {
    const open = await request<OpenItems>(timed(deps.fetch, CALL_TIMEOUT_MS), config, "GET", base);
    const req = open.requests[0];
    let receiptNote = "";
    const warnings: string[] = [];
    if (req && files.length > 0) {
      // A receipt that fails (AI budget used up, judging unavailable) does not stop progress from being saved.
      try {
        const receipt = JSON.parse(
          await callTool(timed(deps.fetch, RECEIPT_TIMEOUT_MS), config, "generate_receipt", {
            requestId: req.id,
            changedFiles: files.slice(0, MAX_RECEIPT_FILES),
            ...(commit && commit !== start ? { commitSha: commit } : {}),
            ...(scan ? { secretFindings: scan.findings, secretFindingsOmitted: scan.omitted } : {}),
          }),
        ) as { receipt_id?: unknown };
        if (typeof receipt.receipt_id === "string") receiptNote = `; receipt ${receipt.receipt_id}`;
      } catch (err) {
        if (err instanceof CliError && err.exitCode === EXIT.server) throw err;
        warnings.push(
          `${WARN} no receipt this time (${err instanceof Error ? err.message : "failed"}).`,
        );
      }
    }
    const after =
      req && files.length > 0
        ? await request<OpenItems>(timed(deps.fetch, CALL_TIMEOUT_MS), config, "GET", base)
        : open;
    const loose = after.requests.flatMap((r) => r.items);
    await callTool(timed(deps.fetch, CALL_TIMEOUT_MS), config, "save_progress", {
      goal: (req?.text || "Agent session").slice(0, 200),
      done: `Changed ${files.length} file${files.length === 1 ? "" : "s"}${receiptNote}`.slice(
        0,
        1000,
      ),
      ...(loose.length > 0
        ? {
            unfinished: loose
              .map((i) => i.text)
              .join("; ")
              .slice(0, 1000),
          }
        : {}),
      nextStep: (loose[0]?.text ?? "Start the next request").slice(0, 500),
    });
    if (loose.length > 0) {
      warnings.push(
        `${WARN} ${loose.length} checklist item${loose.length === 1 ? " is" : "s are"} neither done nor parked:`,
      );
      for (const i of loose.slice(0, MAX_WARNED_ITEMS))
        warnings.push(`  - [${i.status}] ${i.text}`);
      if (loose.length > MAX_WARNED_ITEMS)
        warnings.push(`  ... and ${loose.length - MAX_WARNED_ITEMS} more`);
    }
    if (scan && scan.findings.length + scan.omitted > 0) {
      warnings.push(
        `${WARN} ${scan.findings.length + scan.omitted} possible secret(s) in the changed files; see the receipt.`,
      );
    }
    for (const line of warnings) deps.stderr(line);
    return warnings.length > 0;
  } catch {
    deps.stderr(`${WARN} server unreachable; progress and receipt were not saved.`);
    return true;
  }
}

/** Claude Code headersHelper: the Authorization header from the user-level login (never from a repo file). */
export function mcpHeaders(deps: Pick<HookDeps, "config" | "stdout" | "stderr">): void {
  if (!deps.config) {
    deps.stderr(`${WARN} not logged in (run \`projectbrain login\`).`);
    deps.stdout("{}");
    return;
  }
  deps.stdout(JSON.stringify({ Authorization: `Bearer ${deps.config.token}` }));
}
