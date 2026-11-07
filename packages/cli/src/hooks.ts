import { createHash } from "node:crypto";
import {
  constants,
  closeSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, sep } from "node:path";
import {
  NO_REQUEST_NOTE,
  NO_SNAPSHOT_NOTE,
  brandEnv,
  isCodeceiptSetupPath,
  oneLineText,
  withoutAgentsSection,
} from "@brain/core";
import { CliError, EXIT, request } from "./api";
import type { CliConfig } from "./config";
import { dependencyChanges } from "./dependency-changes";
import { callTool } from "./mcp-client";
import { type Git, changedFiles, repoRoot, scanFiles } from "./scan-secrets";
import {
  type Snapshot,
  type StartBlobs,
  changeSummaries,
  sinceSnapshot,
  startBlobs,
  takeSnapshot,
  validBlobs,
  validSnapshot,
  verifiedBlobs,
  verifiedStartTexts,
} from "./session-snapshot";
import { GAVE_UP, MAX_GATE_BLOCKS, gateAnswer, gateInstruction } from "./stop-gate";
import { localIntegrity, passingTests } from "./test-integrity-local";

// FEAT-016 agent hooks. They fail safe: whatever goes wrong (not logged in, server unreachable, git missing), the
// agent session goes on and the hook prints one short warning. Changed files always come from git, never from the
// agent.
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Agent = "claude" | "cursor" | "codex" | "opencode" | "antigravity" | "manual";
export type HookDeps = {
  fetch: Fetch;
  git: Git;
  cwd: string;
  config: CliConfig | null;
  // Why config is null, as a short phrase for the warning (default: not logged in).
  configProblem?: string;
  readStdin: () => Promise<string>;
  env?: Record<string, string | undefined>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => Date;
  // Called once progress is saved, with what was sent (`codeceipt receipt` prints it).
  done?: (summary: { files: number; receiptId: string | null }) => void;
  // FEAT-020: whether the Stop gate is on for this user (default off here; the CLI passes the user's setting).
  stopGate?: boolean;
  // FEAT-022: starts the repo's check command in the background for a receipt (absent when none is set).
  startCheck?: (receiptId: string) => void;
};

// Claude Code stops a SessionEnd hook after its timeout (we install 60 s): the calls together stay under 50 s, so
// save_progress always gets its turn. A receipt for 20 files takes under 15 s (AC-013-06).
// Roadmap Phase 2b: the start note waits at most this long for the server, then shows the note saved last time (per
// project, at most NOTE_MAX_AGE_MS old) so a slow or unreachable server never holds up the agent for long.
export const START_NOTE_WAIT_MS = 1_500;
const NOTE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const OPEN_ITEMS_TIMEOUT_MS = 7_000;
const RECEIPT_TIMEOUT_MS = 25_000;
const SAVE_TIMEOUT_MS = 8_000;
const MAX_NOTE_CHARS = 4_000;
const MAX_LINE_CHARS = 300;
const OPEN_STATUSES = new Set(["open", "partial", "missed"]);
const MAX_STDIN = 64 * 1024;
const MAX_RECEIPT_FILES = 200;
const MAX_WARNED_ITEMS = 10;
const WARN = "Codeceipt:";
const MAX_AGENTS_MD = 1024 * 1024;

const problemOf = (deps: Pick<HookDeps, "configProblem">) =>
  deps.configProblem ?? "not logged in (run `codeceipt login`)";

const timed =
  (fetchImpl: Fetch, ms: number): Fetch =>
  (url, init) =>
    fetchImpl(url, { ...init, signal: AbortSignal.timeout(ms) });

// Server text is printed to the agent's context or the user's terminal: each line goes through oneLineText (no
// control, C1, separator or bidi characters, so no terminal escapes or forged lines), the direction marks it keeps
// are removed, and the length is capped.
const MARKS = /[\u061c\u200e\u200f]/g;
const clean = (text: string, max: number) =>
  text
    .split("\n")
    .map((l) => oneLineText(l).replace(MARKS, ""))
    .join("\n")
    .slice(0, max);
const line = (text: string) => oneLineText(text).replace(MARKS, "").slice(0, MAX_LINE_CHARS);

async function hookInput(deps: HookDeps): Promise<{ sessionId: string; cwd: string }> {
  let raw: unknown = {};
  try {
    const text = await deps.readStdin();
    if (text.length <= MAX_STDIN) raw = JSON.parse(text);
  } catch {}
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots : input.workspacePaths;
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
  return { sessionId: sessionIdOf(input), cwd };
}

/**
 * The agent's session id from a hook's input: Claude Code and Codex send session_id, Cursor conversation_id,
 * Antigravity conversationId. It names a state file and ties requests to the session, so anything but a plain id is
 * hashed (it can never reach outside the state folder). Every hook of one session derives the same id.
 */
export function sessionIdOf(input: Record<string, unknown>): string {
  const rawId = input.session_id ?? input.conversation_id ?? input.conversationId;
  const id = typeof rawId === "string" ? rawId : "";
  return /^[A-Za-z0-9_-]{1,128}$/.test(id)
    ? id
    : createHash("sha256")
        .update(id || "default")
        .digest("hex")
        .slice(0, 32);
}

// The session's starting commit lives in the repo's .git folder (never committed), keyed by session id. The folder
// must really be inside .git and the file must not be a symlink, so nothing outside the repo is written or removed.
async function stateFile(git: Git, root: string, sessionId: string): Promise<string> {
  const gitDir = realpathSync((await git(["rev-parse", "--absolute-git-dir"], root)).trim());
  // Session state inside .git (never shown to the user); the folder keeps its pre-rename name so a session started
  // before an upgrade still finds its starting commit.
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
    fchmodSync(fd, 0o600); // an existing file keeps its mode on open; make it private again
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

// The session's starting commit and, when a test report is configured, its passing-test count then (FEAT-018).
// D-025: and the working tree's changed files then (paths and hashes); null when missing or not well formed.
type SessionState = {
  start: string | null;
  passing: number | null;
  startedAt: string | null;
  snapshot: Snapshot | null;
  blobs: StartBlobs;
  // Stop hook (owner, 2026-11-01): the receipt it made last and what it was made from.
  receiptId: string | null;
  stopKey: string | null;
  // FEAT-020: how many times the Stop gate has blocked this session.
  gateBlocks: number;
};
const EMPTY_STATE: SessionState = {
  start: null,
  passing: null,
  startedAt: null,
  snapshot: null,
  blobs: {},
  receiptId: null,
  stopKey: null,
  gateBlocks: 0,
};

function readState(file: string): SessionState {
  try {
    if (lstatSync(file).isSymbolicLink()) return EMPTY_STATE;
    const saved = JSON.parse(readFileSync(file, "utf8")) as {
      start?: unknown;
      passing?: unknown;
      startedAt?: unknown;
      snapshot?: unknown;
      blobs?: unknown;
      receiptId?: unknown;
      stopKey?: unknown;
      gateBlocks?: unknown;
    };
    return {
      gateBlocks:
        typeof saved.gateBlocks === "number" && Number.isInteger(saved.gateBlocks)
          ? Math.min(Math.max(saved.gateBlocks, 0), MAX_GATE_BLOCKS)
          : 0,
      receiptId:
        typeof saved.receiptId === "string" && /^[\w-]{1,64}$/.test(saved.receiptId)
          ? saved.receiptId
          : null,
      stopKey:
        typeof saved.stopKey === "string" && /^[0-9a-f]{64}$/.test(saved.stopKey)
          ? saved.stopKey
          : null,
      snapshot: validSnapshot(saved.snapshot),
      blobs: validBlobs(saved.blobs),
      // When the session started: requests recorded without a session id since then belong to it.
      startedAt:
        typeof saved.startedAt === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(saved.startedAt)
          ? saved.startedAt
          : null,
      start:
        typeof saved.start === "string" && /^[0-9a-f]{40,64}$/.test(saved.start)
          ? saved.start
          : null,
      passing:
        typeof saved.passing === "number" && Number.isInteger(saved.passing) && saved.passing >= 0
          ? saved.passing
          : null,
    };
  } catch {
    return EMPTY_STATE;
  }
}

const head = (git: Git, root: string) =>
  git(["rev-parse", "--verify", "-q", "HEAD"], root).then(
    (out) => (/^[0-9a-f]{40,64}$/.test(out.trim()) ? out.trim() : null),
    () => null,
  );

const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
const number = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? Math.min(v, 1_000_000) : 0;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// M: how a pre-session test change is named in the session-end note.
const PRE_TEST_LABEL: Record<string, string> = {
  skipped_tests: "skipped test",
  deleted_tests: "deleted test",
  deleted_test_file: "deleted test file",
  removed_assertions: "removed assertion",
  test_config_changed: "changed test config",
};

/**
 * Journey part 4: the receipt in three lines (done, missed, checks needing attention) and a link to the full receipt.
 * Only counts are read from the server's answer, never its text, so nothing it says reaches the terminal raw.
 */
export function receiptSummary(
  receipt: Record<string, unknown>,
  config: CliConfig,
  receiptId: string | null,
  filesChanged?: number,
): string[] {
  // How many files changed: what the hook sent, or the files the stored receipt lists by feature.
  const grouped = Array.isArray(receipt.files_by_feature)
    ? receipt.files_by_feature.reduce(
        (n: number, g: unknown) =>
          n + count(typeof g === "object" && g !== null ? (g as { files?: unknown }).files : null),
        0,
      )
    : null;
  const nFiles = filesChanged ?? grouped;
  const changed = nFiles === null ? "" : `${plural(Math.min(nFiles, 1_000_000), "file")} changed`;
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const status = (s: string) =>
    items.filter(
      (i) => typeof i === "object" && i !== null && (i as { status?: unknown }).status === s,
    ).length;
  const untested = status("done_untested");
  const done = status("done") + untested;
  const partial = status("partial");
  const missed = status("missed");
  const notVerified = status("not_verified");
  // P: each item is counted in exactly one state; the line lists only the states with a count above zero.
  const states = [
    done > 0 ? `${done} done` : "",
    partial > 0 ? `${partial} partly done` : "",
    missed > 0 ? `${missed} missed` : "",
    notVerified > 0 ? `${notVerified} not verified` : "",
  ].filter(Boolean);
  const postponed = status("postponed");
  const present = status("already_present");
  const questions = status("question");
  const integrity =
    typeof receipt.test_integrity === "object" && receipt.test_integrity !== null
      ? (receipt.test_integrity as Record<string, unknown>)
      : {};
  // Real-test B: what the user asked for is counted apart, never as an alarm.
  const isAsked = (v: unknown) =>
    typeof v === "object" && v !== null && (v as { asked?: unknown }).asked === true;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const askedCount =
    list(receipt.findings).filter(isAsked).length +
    list(integrity.flags).filter(isAsked).length +
    count(receipt.outside_scope_asked);
  const findings =
    count(receipt.findings) -
    list(receipt.findings).filter(isAsked).length +
    number(receipt.findings_omitted);
  const tests =
    count(integrity.flags) -
    list(integrity.flags).filter(isAsked).length +
    number(integrity.omitted);
  const outside = Math.max(0, count(receipt.outside_scope) - count(receipt.outside_scope_asked));
  // "no test changed" entries are the done-without-a-test items, counted above; the rest could not be checked.
  const unverified = (Array.isArray(receipt.not_verified) ? receipt.not_verified : []).filter(
    (n) =>
      typeof n !== "object" ||
      n === null ||
      (n as { reason?: unknown }).reason !== "no test changed",
  ).length;
  const attention = [
    findings > 0 ? plural(findings, "security finding") : "",
    tests > 0 ? plural(tests, "test check") : "",
    untested > 0 ? `${untested} done with no test proving it` : "",
    outside > 0 ? `${plural(outside, "file")} outside the request` : "",
    unverified > 0 ? `${unverified} not verified` : "",
    questions > 0 ? plural(questions, "question") : "",
    postponed > 0 ? `${postponed} postponed` : "",
  ].filter(Boolean);
  const extra = [
    askedCount > 0 ? `${askedCount} you asked for` : "",
    present > 0 && receipt.no_changes !== true ? `${present} already present` : "",
    count(receipt.new_dependencies) > 0
      ? plural(
          count(receipt.new_dependencies),
          "dependency added or changed",
          "dependencies added or changed",
        )
      : "",
  ].filter(Boolean);
  const lines = [
    receipt.no_request === true
      ? `Codeceipt receipt: ${changed ? `${changed}. ` : ""}${NO_REQUEST_NOTE}`
      : receipt.no_changes === true
        ? // Real-test F: a request but no changed file still gets a receipt.
          `Codeceipt receipt: No files changed; ${status("missed")} not done${present > 0 ? `, ${present} already present` : ""}.`
        : `Codeceipt receipt: ${changed ? `${changed}; ` : ""}${states.length > 0 ? states.join(", ") : "no items"}.`,
    `Checks needing attention: ${attention.length > 0 ? attention.join(", ") : "none"}.`,
    ...(extra.length > 0 ? [`Also listed: ${extra.join(", ")}.`] : []),
  ];
  if (receiptId) {
    const base = config.apiUrl.replace(/\/+$/, "");
    lines.push(
      `Full receipt: ${base}/projects/${encodeURIComponent(config.projectId)}/receipts#receipt-${receiptId}`,
    );
  }
  return lines;
}

/**
 * First-receipt fix: the changed files without Codeceipt's own setup. AGENTS.md stays only when something besides
 * the section init adds changed (compared with the session's start, or HEAD).
 */
async function withoutSetupFiles(
  git: Git,
  root: string,
  base: string,
  files: string[],
): Promise<string[]> {
  const kept = files.filter((f) => !isCodeceiptSetupPath(f));
  if (!kept.includes("AGENTS.md")) return kept;
  let now = "";
  let before = "";
  try {
    const abs = join(root, "AGENTS.md");
    if (lstatSync(abs).isFile() && lstatSync(abs).size <= MAX_AGENTS_MD)
      now = readFileSync(abs, "utf8");
  } catch {}
  try {
    before = await git(["show", `${base}:AGENTS.md`], root);
  } catch {}
  return withoutAgentsSection(now) === withoutAgentsSection(before)
    ? kept.filter((f) => f !== "AGENTS.md")
    : kept;
}

/** The newest session recorded by a session-start hook in this repo (for `codeceipt receipt`), or null. */
export async function latestSession(git: Git, cwd: string): Promise<string | null> {
  const root = await repoRoot(git, cwd);
  const gitDir = realpathSync((await git(["rev-parse", "--absolute-git-dir"], root)).trim());
  const dir = join(gitDir, "projectbrain");
  if (lstatSync(dir).isSymbolicLink()) return null;
  let newest: { id: string; at: number } | null = null;
  for (const name of readdirSync(dir).slice(0, 1000)) {
    const m = /^session-([A-Za-z0-9_-]{1,128})\.json$/.exec(name);
    if (!m?.[1]) continue;
    const st = lstatSync(join(dir, name));
    if (!st.isFile()) continue;
    if (!newest || st.mtimeMs > newest.at) newest = { id: m[1], at: st.mtimeMs };
  }
  return newest?.id ?? null;
}

/** Session start: remembers the starting commit and shows the handoff note from where_did_we_stop. */
export async function sessionStart(agent: Agent, deps: HookDeps): Promise<void> {
  const { sessionId, cwd } = await hookInput(deps);
  // The note is asked for first, so the server works while the snapshot is taken (Phase 2b).
  const asked = deps.config
    ? // Aborted at the wait limit, so a slow server never keeps the hook's process alive afterwards.
      callTool(timed(deps.fetch, START_NOTE_WAIT_MS), deps.config, "where_did_we_stop", {})
    : null;
  asked?.catch(() => {}); // settled later; never an unhandled rejection
  let saved: string | null = null;
  try {
    const root = await repoRoot(deps.git, cwd);
    const file = await stateFile(deps.git, root, sessionId);
    // Next to the session state folder, inside .git (never shown to the user, never committed).
    saved = join(dirname(dirname(file)), "codeceipt-start-note.json");
    const passing = await passingTests(root, brandEnv(deps.env ?? {}, "TEST_REPORT"));
    const state = {
      start: await head(deps.git, root),
      passing,
      startedAt: (deps.now?.() ?? new Date()).toISOString(),
    };
    // Written before hashing, so a hook stopped while hashing still keeps the starting commit (no snapshot then).
    writeState(file, JSON.stringify(state));
    const snapshot = await takeSnapshot(deps.git, root).catch(() => null);
    if (snapshot) {
      const blobs = await startBlobs(deps.git, root, snapshot).catch(() => ({}));
      writeState(file, JSON.stringify({ ...state, snapshot, blobs }));
    }
  } catch {
    // Not a git repo: session end then compares with HEAD.
  }
  if (!deps.config || !asked) return deps.stderr(`${WARN} ${problemOf(deps)}; no handoff note.`);
  const now = deps.now?.() ?? new Date();
  let note: string;
  const fresh = await within(asked, START_NOTE_WAIT_MS);
  // A refused token (revoked, project deleted or suspended) is not "slow": the saved note is deleted and never shown.
  if (!fresh.ok && fresh.reason instanceof CliError && fresh.reason.exitCode === EXIT.auth) {
    if (saved) rmSync(saved, { force: true });
    return deps.stderr(`${WARN} ${oneLineText(fresh.reason.message)}; no handoff note.`);
  }
  if (fresh.ok) {
    note = fresh.value;
    if (saved)
      saveNote(saved, { projectId: deps.config.projectId, note, savedAt: now.toISOString() });
  } else {
    const earlier = saved ? readSavedNote(saved, deps.config.projectId, now) : null;
    if (!earlier) {
      return deps.stderr(`${WARN} server unreachable; no handoff note this session.`);
    }
    deps.stderr(`${WARN} server unreachable or slow; showing the note saved ${earlier.savedAt}.`);
    note = `(Saved earlier, ${earlier.savedAt}: the server did not answer in time.)\n${earlier.note}`;
  }
  const safe = clean(note, MAX_NOTE_CHARS);
  // Claude Code and OpenCode's plugin add plain stdout to the session; Cursor reads additional_context, Antigravity
  // injectSteps and Codex hookSpecificOutput.additionalContext from JSON. Codex reads JSON stdout as hook control, so
  // the note always goes inside our own envelope there: a note that is itself JSON stays data.
  deps.stdout(
    agent === "cursor"
      ? JSON.stringify({ additional_context: safe })
      : agent === "antigravity"
        ? JSON.stringify({ injectSteps: [{ systemMessage: { systemMessage: safe } }] })
        : agent === "codex"
          ? JSON.stringify({
              hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: safe },
            })
          : safe,
  );
}

// Resolves with the promise's value, or { ok: false } after `ms` or with the rejection's reason.
async function within<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ ok: true; value: T } | { ok: false; reason?: unknown }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ ok: false }>((r) => {
    timer = setTimeout(() => r({ ok: false }), ms);
  });
  try {
    return await Promise.race([p.then((value) => ({ ok: true as const, value })), late]);
  } catch (reason) {
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

type SavedNote = { projectId: string; note: string; savedAt: string };

// Saved inside the repo's .git folder like the session state (writeState: 0600, never through a symlink).
function saveNote(file: string, saved: SavedNote): void {
  try {
    writeState(file, JSON.stringify({ ...saved, note: clean(saved.note, MAX_NOTE_CHARS) }));
  } catch {
    // A note that cannot be saved only means no fallback next time.
  }
}

// The saved note, only for this project and only when it is less than NOTE_MAX_AGE_MS old. Never through a symlink.
function readSavedNote(file: string, projectId: string, now: Date): SavedNote | null {
  try {
    // A regular file of a sane size only: never a symlink, a FIFO (would block) or a huge file.
    const st = lstatSync(file);
    if (!st.isFile() || st.size > 64 * 1024) return null;
    const v = JSON.parse(readFileSync(file, "utf8")) as Partial<SavedNote>;
    if (v.projectId !== projectId || typeof v.note !== "string" || typeof v.savedAt !== "string")
      return null;
    const at = Date.parse(v.savedAt);
    if (!Number.isFinite(at) || now.getTime() - at > NOTE_MAX_AGE_MS || at > now.getTime() + 60_000)
      return null;
    return {
      projectId,
      note: v.note,
      savedAt: new Date(at).toISOString().slice(0, 16).replace("T", " "),
    };
  } catch {
    return null;
  }
}

type OpenItems = {
  requests: { id: string; text: string; items: { text: string; status: string }[] }[];
  // The requests made in this session (requests tied to sessions); absent from older servers.
  session_requests?: unknown;
};

const MAX_SESSION_RECEIPTS = 3;

// This session's requests from the open-items answer: only well-formed ids, newest first, capped.
function sessionRequests(open: OpenItems): { id: string; text: string }[] {
  const list = Array.isArray(open.session_requests) ? open.session_requests : [];
  return list
    .flatMap((r) =>
      typeof r === "object" &&
      r !== null &&
      typeof (r as { id?: unknown }).id === "string" &&
      /^[\w-]{1,64}$/.test((r as { id: string }).id)
        ? [{ id: (r as { id: string }).id, text: String((r as { text?: unknown }).text ?? "") }]
        : [],
    )
    .slice(0, MAX_SESSION_RECEIPTS);
}

// One session can have several requests, each with its own receipt: the summary adds their item counts; the changed
// files and checks are the same for all of them, so they are taken from the first.
function combineReceipts(receipts: Record<string, unknown>[]): Record<string, unknown> {
  const [first = {}] = receipts;
  return {
    ...first,
    items: receipts.flatMap((r) => (Array.isArray(r.items) ? r.items : [])),
    no_request: receipts.every((r) => r.no_request === true),
  };
}

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

// Work items neither done nor parked, as clean short lines; anything of the wrong shape is dropped. Real-test H:
// questions are not work, and the same item from a repeated request is listed once (newest request first).
function openList(open: OpenItems): { text: string; status: string }[] {
  const requests = Array.isArray(open?.requests) ? open.requests : [];
  const seen = new Set<string>();
  return requests.flatMap((r) =>
    (Array.isArray(r?.items) ? r.items : []).flatMap((i) => {
      if (typeof i?.text !== "string" || !OPEN_STATUSES.has(i.status)) return [];
      if ((i as { question?: unknown }).question === true) return [];
      const text = line(i.text);
      const key = text.toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ text, status: i.status }];
    }),
  );
}

/**
 * Session end: takes the changed files from git (against the session's starting commit, plus untracked files), scans
 * them for secrets on this machine, asks for a receipt for the newest open request, saves progress and warns about
 * checklist items that are neither done nor parked. Returns true when there is something to warn about.
 */
export async function sessionEnd(
  _agent: Agent,
  deps: HookDeps,
  // Stop (owner, 2026-11-01): Claude finished responding. The session goes on: its state is kept, the receipt it
  // made before is replaced, and nothing is sent when nothing changed since then.
  opts: { stop?: boolean } = {},
): Promise<boolean> {
  const { sessionId, cwd } = await hookInput(deps);
  if (!deps.config) {
    deps.stderr(`${WARN} ${problemOf(deps)}; progress was not saved.`);
    return true;
  }
  const config = deps.config;
  let root = cwd;
  let files: string[] = [];
  // Every changed file, before the snapshot filter: what the secret scan reads.
  let allChanged: string[] = [];
  // What the receipt is about: the changed files minus Codeceipt's own setup (the secret scan still sees them all).
  let receiptFiles: string[] = [];
  let start: string | null = null;
  let commit: string | null = null;
  let passingBefore: number | null = null;
  let startedAt: string | null = null;
  let snapshot: Snapshot | null = null;
  let blobs: StartBlobs = {};
  // D-025: changed files that were already modified at the start, and whether there was no start snapshot.
  let preExisting: string[] = [];
  let noSnapshot = false;
  let stateFilePath: string | null = null;
  let previous: { receiptId: string | null; stopKey: string | null; gateBlocks: number } = {
    receiptId: null,
    stopKey: null,
    gateBlocks: 0,
  };
  try {
    root = await repoRoot(deps.git, cwd);
    const file = await stateFile(deps.git, root, sessionId);
    stateFilePath = file;
    let receiptId: string | null;
    let stopKey: string | null;
    let gateBlocks: number;
    ({
      start,
      passing: passingBefore,
      startedAt,
      snapshot,
      blobs,
      receiptId,
      stopKey,
      gateBlocks,
    } = readState(file));
    previous = { receiptId, stopKey, gateBlocks };
    if (!opts.stop) rmSync(file, { force: true });
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
    allChanged = files;
    // Only the session's own changes: files new or different since the start snapshot (also for the test checks; the
    // secret scan reads every changed file). Without a snapshot every changed file counts and the receipt says so.
    if (snapshot) ({ files, preExisting } = await sinceSnapshot(root, files, snapshot));
    else noSnapshot = true;
    receiptFiles = await withoutSetupFiles(deps.git, root, start ?? "HEAD", files);
  } catch {
    // Not a git repo: no changed files can be known, so none are claimed.
  }
  // Owner, 2026-10-31: the secret scan sees every changed file, whatever the snapshot says (fail safe). Findings in
  // files untouched since the snapshot are the user's earlier work: sent apart, never as the session's.
  const scan = await scanFiles(deps.git, root, allChanged).catch(() => null);
  const session = new Set(files);
  const sessionFindings = scan?.findings.filter((f) => session.has(f.file)) ?? [];
  const beforeFindings = scan?.findings.filter((f) => !session.has(f.file)) ?? [];
  // FEAT-018: tests deleted, skipped or weakened, compared on this machine; only names and counts are sent.
  // M: a file already modified before the session is compared with its start content (verified), so its earlier
  // skips are not the session's; they are reported apart below.
  const startTexts = snapshot
    ? await verifiedStartTexts(
        deps.git,
        root,
        Object.fromEntries(Object.entries(blobs).filter(([path]) => preExisting.includes(path))),
        snapshot,
      ).catch(() => ({}))
    : {};
  const integrity = await localIntegrity(
    deps.git,
    root,
    start ?? (commit ? "HEAD" : null),
    files,
    startTexts,
  ).catch(() => null);
  const passingAfter = await passingTests(root, brandEnv(deps.env ?? {}, "TEST_REPORT"));
  // D-025: what changed in each file (counts, symbol names, places), computed here; never source text.
  const summaries = await changeSummaries(
    deps.git,
    root,
    start ?? (commit ? "HEAD" : null),
    receiptFiles.slice(0, MAX_RECEIPT_FILES),
    // Only files already modified at the start and changed further are diffed against their start content, and only
    // with a start blob that matches the snapshot.
    snapshot
      ? await verifiedBlobs(
          deps.git,
          root,
          Object.fromEntries(Object.entries(blobs).filter(([path]) => preExisting.includes(path))),
          snapshot,
        ).catch(() => ({}))
      : {},
  ).catch(() => []);
  const marked = preExisting.filter((f) => receiptFiles.includes(f));
  // Real-test I: every package.json this session changed, reduced to dependency names and ranges, before and after.
  const dependencies = await dependencyChanges(
    deps.git,
    root,
    start ?? (commit ? "HEAD" : null),
    receiptFiles,
    snapshot
      ? await verifiedBlobs(
          deps.git,
          root,
          Object.fromEntries(Object.entries(blobs).filter(([path]) => preExisting.includes(path))),
          snapshot,
        ).catch(() => ({}))
      : {},
  ).catch(() => []);
  // Only this session's requests are checked by its receipt (requests are tied to sessions).
  const base = `/api/hooks/${encodeURIComponent(config.projectId)}/open-items?session=${encodeURIComponent(sessionId)}${startedAt ? `&since=${encodeURIComponent(startedAt)}` : ""}`;
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
    const own = sessionRequests(open);
    const req = own[0];
    // Stop: the same files, summaries, dependencies and requests as the last receipt need no new one.
    const stopKey = createHash("sha256")
      .update(
        JSON.stringify({
          files: receiptFiles,
          summaries,
          dependencies,
          requests: own.map((r) => r.id),
          findings: sessionFindings.length,
          flags: integrity?.flags.length ?? 0,
        }),
      )
      .digest("hex");
    if (
      opts.stop &&
      (stopKey === previous.stopKey || (receiptFiles.length === 0 && own.length === 0))
    )
      return false;
    let receiptNote = "";
    let receiptId: string | null = null;
    let gate: { instruction: string; blocks: number } | null = null;
    let gaveUp = false;
    const summary: string[] = [];
    const warnings: string[] = [];
    // A session that changed files always gets a receipt (dogfooding): one per request made in this session (newest
    // first, at most MAX_SESSION_RECEIPTS), or one without a request. Earlier sessions' open items are never judged.
    // Real-test F: a session with a recorded request gets a receipt even when it changed no file ("No files changed").
    if (receiptFiles.length > 0 || own.length > 0) {
      const receipts: Record<string, unknown>[] = [];
      for (const requestId of own.length > 0 ? own.map((r) => r.id) : [undefined]) {
        // A receipt that fails (AI budget used up, judging unavailable) does not stop progress from being saved.
        try {
          const receipt = JSON.parse(
            await callTool(timed(deps.fetch, RECEIPT_TIMEOUT_MS), config, "generate_receipt", {
              ...(requestId ? { requestId } : {}),
              // One receipt per session: a later Stop or the session end replaces the one made before.
              ...(previous.receiptId && requestId === own[0]?.id
                ? { replacesReceiptId: previous.receiptId }
                : {}),
              changedFiles: receiptFiles.slice(0, MAX_RECEIPT_FILES),
              ...(summaries.length > 0 ? { changeSummaries: summaries } : {}),
              ...(marked.length > 0
                ? { preExistingFiles: marked.slice(0, MAX_RECEIPT_FILES) }
                : {}),
              ...(noSnapshot ? { snapshot: "missing" } : {}),
              ...(commit && commit !== start ? { commitSha: commit } : {}),
              // Real-test I: dependency names and version ranges only, never the rest of package.json.
              ...(dependencies.length > 0 ? { packageJson: dependencies } : {}),
              ...(scan
                ? {
                    secretFindings: sessionFindings,
                    secretFindingsOmitted: scan.omitted,
                    ...(beforeFindings.length > 0
                      ? { secretFindingsBeforeSession: beforeFindings }
                      : {}),
                  }
                : {}),
              // Sent only when there is something to report: flags or test counts.
              ...(integrity &&
              (integrity.flags.length > 0 || passingBefore !== null || passingAfter !== null)
                ? {
                    testIntegrity: {
                      flags: integrity.flags,
                      ...(integrity.omitted > 0 ? { omitted: integrity.omitted } : {}),
                      passingBefore,
                      passingAfter,
                    },
                  }
                : {}),
            }),
          ) as Record<string, unknown>;
          receipts.push(receipt);
          if (
            !receiptId &&
            typeof receipt.receipt_id === "string" &&
            /^[\w-]{1,64}$/.test(receipt.receipt_id)
          ) {
            receiptId = receipt.receipt_id;
            receiptNote = `; receipt ${receipt.receipt_id}`;
          }
        } catch (err) {
          if (err instanceof CliError && err.exitCode === EXIT.server) throw err;
          // Only our own messages are shown, never text from the server's answer.
          warnings.push(
            `${WARN} no receipt this time (${err instanceof CliError ? line(err.message) : "unreadable answer"}).`,
          );
          break;
        }
      }
      // FEAT-022: the session's end starts the check command for its receipt (not every Stop).
      if (!opts.stop && receiptId) deps.startCheck?.(receiptId);
      if (opts.stop && stateFilePath && receiptId) {
        try {
          const raw = JSON.parse(readFileSync(stateFilePath, "utf8")) as Record<string, unknown>;
          writeState(stateFilePath, JSON.stringify({ ...raw, receiptId, stopKey }));
        } catch {}
      }
      if (receipts.length > 0) {
        const combined = combineReceipts(receipts);
        summary.push(...receiptSummary(combined, config, receiptId, receiptFiles.length));
        // FEAT-020: at Stop, unfinished work keeps the agent going, at most MAX_GATE_BLOCKS times per session.
        if (opts.stop && deps.stopGate) {
          const instruction = gateInstruction(combined);
          if (instruction && previous.gateBlocks >= MAX_GATE_BLOCKS) gaveUp = true;
          else if (instruction) gate = { instruction, blocks: previous.gateBlocks + 1 };
        }
        if (noSnapshot) warnings.push(`${WARN} ${NO_SNAPSHOT_NOTE}`);
        if (beforeFindings.length > 0) {
          warnings.push(
            `${WARN} already in your working tree before this session: ${plural(beforeFindings.length, "secret finding")} (see the full receipt).`,
          );
        }
      }
    }
    const after =
      own.length > 0
        ? await request<OpenItems>(timed(deps.fetch, OPEN_ITEMS_TIMEOUT_MS), config, "GET", base)
        : open;
    const loose = openList(after);
    await callTool(timed(deps.fetch, SAVE_TIMEOUT_MS), config, "save_progress", {
      goal: (req ? line(req.text) : "") || "Agent session",
      done: `Changed ${receiptFiles.length} file${receiptFiles.length === 1 ? "" : "s"}${receiptNote}`.slice(
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
    deps.done?.({ files: receiptFiles.length, receiptId });
    if (loose.length > 0) {
      warnings.push(
        `${WARN} ${loose.length} checklist item${loose.length === 1 ? " is" : "s are"} neither done nor parked:`,
      );
      for (const i of loose.slice(0, MAX_WARNED_ITEMS))
        warnings.push(`  - [${i.status}] ${i.text}`);
      if (loose.length > MAX_WARNED_ITEMS)
        warnings.push(`  ... and ${loose.length - MAX_WARNED_ITEMS} more`);
    }
    const testWarnings =
      (integrity ? integrity.flags.length + integrity.omitted : 0) +
      (passingBefore !== null && passingAfter !== null && passingAfter < passingBefore ? 1 : 0);
    if (testWarnings > 0) {
      warnings.push(
        `${WARN} ${testWarnings} sign(s) that tests were removed or weakened; see the receipt.`,
      );
    }
    // M: test changes that were already in the working tree before the session: shown apart, never counted.
    const earlier = integrity?.beforeSession ?? [];
    if (earlier.length > 0) {
      const items = earlier
        .slice(0, MAX_WARNED_ITEMS)
        .map((f) => `${plural(f.count, PRE_TEST_LABEL[f.kind] ?? "test change")} in ${f.file}`);
      warnings.push(
        `${WARN} already modified before this session, not counted: ${items.join("; ")}.`,
      );
    }
    if (scan && scan.findings.length + scan.omitted > 0) {
      warnings.push(
        `${WARN} ${scan.findings.length + scan.omitted} possible secret(s) in the changed files; see the receipt.`,
      );
    }
    if (gaveUp) warnings.push(`${WARN} ${GAVE_UP}`);
    // The receipt summary first (journey part 4), then the warnings.
    for (const line of [...summary, ...warnings]) deps.stderr(line);
    const answer = gate ? gateAnswer(_agent, gate.instruction) : null;
    if (gate && answer && stateFilePath) {
      try {
        const raw = JSON.parse(readFileSync(stateFilePath, "utf8")) as Record<string, unknown>;
        writeState(stateFilePath, JSON.stringify({ ...raw, gateBlocks: gate.blocks }));
        deps.stdout(answer);
      } catch {}
    }
    return summary.length + warnings.length > 0;
  } catch {
    deps.stderr(`${WARN} server unreachable; progress and receipt were not saved.`);
    return true;
  }
}

/**
 * Claude Code headersHelper: the Authorization header from the user-level login (never from a repo file), only for
 * the logged-in Codeceipt server. Claude Code names the server in CLAUDE_CODE_MCP_SERVER_URL; a cloned repo's own
 * server using this helper (or an unknown caller) gets no header.
 */
export function mcpHeaders(
  deps: Pick<HookDeps, "config" | "configProblem" | "stdout" | "stderr"> & {
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
    deps.stderr(`${WARN} ${problemOf(deps)}.`);
  } else if (origin(deps.env.CLAUDE_CODE_MCP_SERVER_URL) !== origin(deps.config.apiUrl)) {
    deps.stderr(`${WARN} no token for this MCP server: it is not the server you logged in to.`);
  } else {
    deps.stdout(JSON.stringify({ Authorization: `Bearer ${deps.config.token}` }));
    return;
  }
  deps.stdout("{}");
}
