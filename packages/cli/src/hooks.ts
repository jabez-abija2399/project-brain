import { createHash } from "node:crypto";
import {
  constants,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeSync,
} from "node:fs";
import { isAbsolute, join, sep } from "node:path";
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

// Claude Code stops a SessionEnd hook after its timeout (we install 60 s): the calls together stay under 50 s, so
// save_progress always gets its turn. A receipt for 20 files takes under 15 s (AC-013-06).
const START_TIMEOUT_MS = 8_000;
const OPEN_ITEMS_TIMEOUT_MS = 7_000;
const RECEIPT_TIMEOUT_MS = 25_000;
const SAVE_TIMEOUT_MS = 8_000;
const MAX_NOTE_CHARS = 4_000;
const MAX_LINE_CHARS = 300;
const OPEN_STATUSES = new Set(["open", "partial", "missed"]);
const MAX_STDIN = 64 * 1024;
const MAX_RECEIPT_FILES = 200;
const MAX_WARNED_ITEMS = 10;
const WARN = "Project Brain:";

const timed =
  (fetchImpl: Fetch, ms: number): Fetch =>
  (url, init) =>
    fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) });

// Server text is printed to the agent's context or the user's terminal: no control, C1 or direction characters
// (terminal escapes, forged lines), and a fixed length.
// Built from a string so the escapes stay escapes (no literal control or line-separator characters in the source).
const UNSAFE =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
const clean = (text: string, max: number) => text.replace(UNSAFE, "").slice(0, max);
const line = (text: string) => clean(text.replace(/[\r\n\t]+/g, " "), MAX_LINE_CHARS);

async function hookInput(deps: HookDeps): Promise<{ sessionId: string; cwd: string }> {
  let raw: unknown = {};
  try {
    const text = await deps.readStdin();
    if (text.length <= MAX_STDIN) raw = JSON.parse(text);
  } catch {}
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  // Cursor names the chat conversation_id in some events.
  const rawId = input.session_id ?? input.conversation_id;
  const id = typeof rawId === "string" ? rawId : "";
  const roots = input.workspace_roots;
  const claimed =
    typeof input.cwd === "string" && isAbsolute(input.cwd)
      ? input.cwd
      : Array.isArray(roots) && typeof roots[0] === "string" && isAbsolute(roots[0])
        ? roots[0]
        : deps.cwd;
  // The agent runs hooks in the project; a cwd on stdin is used only when it is in the same repo, so another repo's
  // files are never claimed for this project.
  const [own, other] = await Promise.all([
    repoRoot(deps.git, deps.cwd).catch(() => deps.cwd),
    repoRoot(deps.git, claimed).catch(() => claimed),
  ]);
  const cwd = own === other ? claimed : deps.cwd;
  // The id names a state file: anything but a plain id is hashed, so it cannot reach outside the state folder.
  const sessionId = /^[A-Za-z0-9_-]{1,128}$/.test(id)
    ? id
    : createHash("sha256")
        .update(id || "default")
        .digest("hex")
        .slice(0, 32);
  return { sessionId, cwd };
}

// The session's starting commit lives in the repo's .git folder (never committed), keyed by session id. The folder
// must really be inside .git and the file must not be a symlink, so nothing outside the repo is written or removed.
async function stateFile(git: Git, root: string, sessionId: string): Promise<string> {
  const gitDir = realpathSync((await git(["rev-parse", "--absolute-git-dir"], root)).trim());
  const dir = join(gitDir, "projectbrain");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink() || !realpathSync(dir).startsWith(gitDir + sep)) {
    throw new Error("state folder outside .git");
  }
  return join(dir, `session-${sessionId}.json`);
}

function writeState(file: string, text: string) {
  // O_NOFOLLOW: a symlink planted at the state file makes the write fail instead of following it.
  const fd = openSync(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

function readState(file: string): string | null {
  try {
    if (lstatSync(file).isSymbolicLink()) return null;
    const saved = JSON.parse(readFileSync(file, "utf8")) as { start?: unknown };
    return typeof saved.start === "string" && /^[0-9a-f]{40,64}$/.test(saved.start)
      ? saved.start
      : null;
  } catch {
    return null;
  }
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
    writeState(file, JSON.stringify({ start: await head(deps.git, root) }));
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
  const safe = clean(note, MAX_NOTE_CHARS);
  // Claude Code adds plain stdout to the session; Cursor reads additional_context from JSON.
  deps.stdout(agent === "cursor" ? JSON.stringify({ additional_context: safe }) : safe);
}

type OpenItems = {
  requests: { id: string; text: string; items: { text: string; status: string }[] }[];
};

// The answer has the shape the hook expects (else it is reported as unreadable, never trusted in part).
const wellFormed = (open: OpenItems) =>
  Array.isArray(open?.requests) &&
  open.requests.every(
    (r) =>
      typeof r?.id === "string" &&
      typeof r.text === "string" &&
      Array.isArray(r.items) &&
      r.items.every((i) => typeof i?.text === "string" && typeof i.status === "string"),
  );

// Items neither done nor parked, as clean short lines; anything of the wrong shape is dropped.
function openList(open: OpenItems): { text: string; status: string }[] {
  const requests = Array.isArray(open?.requests) ? open.requests : [];
  return requests.flatMap((r) =>
    (Array.isArray(r?.items) ? r.items : []).flatMap((i) =>
      typeof i?.text === "string" && OPEN_STATUSES.has(i.status)
        ? [{ text: line(i.text), status: i.status }]
        : [],
    ),
  );
}

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
    start = readState(file);
    rmSync(file, { force: true });
    commit = await head(deps.git, root);
    // A start that is not an ancestor of HEAD (history rewritten, state file edited) cannot bound the session.
    if (start && commit) {
      const ancestor = await deps.git(["merge-base", "--is-ancestor", start, commit], root).then(
        () => true,
        () => false,
      );
      if (!ancestor) start = null;
    }
    files = await changedFiles(deps.git, root, start ?? undefined);
  } catch {
    // Not a git repo: no changed files can be known, so none are claimed.
  }
  const scan = await scanFiles(deps.git, root, files).catch(() => null);
  const base = `/api/hooks/${encodeURIComponent(config.projectId)}/open-items`;
  try {
    const open = await request<OpenItems>(
      timed(deps.fetch, OPEN_ITEMS_TIMEOUT_MS),
      config,
      "GET",
      base,
    );
    if (!wellFormed(open)) {
      deps.stderr(`${WARN} the server's open-items answer was unreadable; no receipt this time.`);
      return true;
    }
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
        if (typeof receipt.receipt_id === "string" && /^[\w-]{1,64}$/.test(receipt.receipt_id)) {
          receiptNote = `; receipt ${receipt.receipt_id}`;
        }
      } catch (err) {
        if (err instanceof CliError && err.exitCode === EXIT.server) throw err;
        // Only our own messages are shown, never text from the server's answer.
        warnings.push(
          `${WARN} no receipt this time (${err instanceof CliError ? line(err.message) : "unreadable answer"}).`,
        );
      }
    }
    const after =
      req && files.length > 0
        ? await request<OpenItems>(timed(deps.fetch, OPEN_ITEMS_TIMEOUT_MS), config, "GET", base)
        : open;
    const loose = openList(after);
    await callTool(timed(deps.fetch, SAVE_TIMEOUT_MS), config, "save_progress", {
      goal: (req ? line(req.text) : "") || "Agent session",
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

/**
 * Claude Code headersHelper: the Authorization header from the user-level login (never from a repo file), only for
 * the logged-in Project Brain server. Claude Code names the server in CLAUDE_CODE_MCP_SERVER_URL; a cloned repo's own
 * server using this helper (or an unknown caller) gets no header.
 */
export function mcpHeaders(
  deps: Pick<HookDeps, "config" | "stdout" | "stderr"> & {
    env: Record<string, string | undefined>;
  },
): void {
  const origin = (url: string | undefined) => {
    try {
      return url ? new URL(url).origin : null;
    } catch {
      return null;
    }
  };
  if (!deps.config) {
    deps.stderr(`${WARN} not logged in (run \`projectbrain login\`).`);
  } else if (origin(deps.env.CLAUDE_CODE_MCP_SERVER_URL) !== origin(deps.config.apiUrl)) {
    deps.stderr(`${WARN} no token for this MCP server: it is not the server you logged in to.`);
  } else {
    deps.stdout(JSON.stringify({ Authorization: `Bearer ${deps.config.token}` }));
    return;
  }
  deps.stdout("{}");
}
