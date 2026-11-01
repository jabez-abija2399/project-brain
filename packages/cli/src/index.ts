import { existsSync, statSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  MAX_REQUEST_CHARS,
  brandEnv,
  fingerprintToken,
  maskSecretsIn,
  sameRepo,
} from "@brain/core";
import { CliError, EXIT, REPO_MISMATCH_MESSAGE, request } from "./api";
import {
  type CliConfig,
  configPath,
  legacyConfigPath,
  readConfig,
  readProjectToken,
  saveProjectToken,
  writeConfig,
} from "./config";
import {
  latestSession,
  mcpHeaders,
  receiptSummary,
  sessionEnd,
  sessionIdOf,
  sessionStart,
} from "./hooks";
import { runIndex } from "./index-command";
import { AGENTS, type Agent, initReport, runInit } from "./init-command";
import { attentionLines } from "./last-attention";
import { evidenceLines } from "./last-evidence";
import { runMcpProxy } from "./mcp-proxy";
import {
  gitDirOf,
  readRepoLink,
  removeRepoLink,
  repoFingerprint,
  writeRepoLink,
} from "./repo-link";
import { type Git, repoRoot, runGit, runScanSecrets } from "./scan-secrets";
import { onPath, runSetup } from "./setup-command";

export const PACKAGE = "@brain/cli";
export const VERSION = "0.1.0";
// The hosted Codeceipt; --api-url or CODECEIPT_API_URL points the CLI elsewhere (for example http://localhost:3000).
export const DEFAULT_API_URL = "https://codeceipts.vercel.app";

export function helpText(): string {
  return [
    `codeceipt ${VERSION}: A receipt for every AI change.`,
    "  codeceipt                           connects this repo: approve a code in your browser, then index and set up agents",
    "  codeceipt login [--api-url <url>]   reads the project token from stdin or CODECEIPT_TOKEN",
    "  codeceipt index [dir]               indexes the repo locally and uploads metadata only",
    "  codeceipt index --rebuild [dir]     clears the project's stored index and rebuilds it from this repo only",
    "  codeceipt unlink                    disconnects this repo from its project (run npx codeceipt to connect again)",
    "  codeceipt scan-secrets [files...]   scans changed (or named) files for secrets; prints masked findings",
    "  codeceipt init [--claude] [--cursor] [--codex] [--opencode] [--antigravity]",
    "                                      sets up the agents found here (MCP config, hooks, skill or rule, AGENTS.md)",
    "  codeceipt receipt                   saves a receipt and progress now (for agents with no session-end event)",
    "  codeceipt last                      prints the latest receipt's summary and link again",
    "  codeceipt last --evidence           also prints the code-free evidence the judge was given, per file",
  ].join("\n");
}

export type CliDeps = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  env: Record<string, string | undefined>;
  cwd: string;
  homedir?: string;
  platform?: NodeJS.Platform;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  readStdin: () => Promise<string>;
  // Waits between 429 retries and approval polls; tests inject one that does not really wait.
  sleep?: (ms: number) => Promise<void>;
  // The agent's MCP messages, one per line (`codeceipt mcp-proxy`); main.ts reads them from stdin.
  stdinLines?: () => AsyncIterable<string>;
  // Opens the approval page (`codeceipt` with no arguments); tests inject one. False when no browser opened.
  openUrl?: (url: string) => Promise<boolean>;
  hasCommand?: (name: string) => boolean;
  // Starts this CLI again with `args` in the background, `input` on its stdin (Codex's 3-second session end).
  spawnBackground?: (args: string[], input: string, cwd: string) => void;
  git?: Git;
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new CliError(EXIT.usage, `${name} needs a value.`);
  args.splice(i, 2);
  return value;
}

// The token travels in every request: https only, except a local dev server.
function isSafeApiUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

async function login(args: string[], deps: CliDeps, path: string): Promise<void> {
  // CODECEIPT_* first; the PROJECTBRAIN_* names from before the rename still work (D-019).
  const apiUrl = flag(args, "--api-url") ?? brandEnv(deps.env, "API_URL") ?? DEFAULT_API_URL;
  if (args.length > 0) throw new CliError(EXIT.usage, `Unknown argument: ${args[0]}`);
  if (!isSafeApiUrl(apiUrl))
    throw new CliError(
      EXIT.usage,
      "--api-url must be https (plain http only for localhost, 127.0.0.1 or [::1]).",
    );
  const token = (brandEnv(deps.env, "TOKEN") ?? (await deps.readStdin())).trim();
  if (!token) throw new CliError(EXIT.usage, "No token: paste it on stdin or set CODECEIPT_TOKEN.");
  const who = await request<{ project_id: string }>(
    deps.fetch,
    { apiUrl, token },
    "GET",
    "/api/token/whoami",
  );
  const config = { apiUrl, projectId: who.project_id, token };
  deps.stdout(`Logged in as project ${who.project_id}`);
  // Inside a git repo the login is this repo's: its token is kept per project and the repo is linked to it (D-020).
  const gitDir = await gitDirOf(deps.git ?? runGit, deps.cwd);
  if (!gitDir) return writeConfig(path, config);
  saveProjectToken(path, config);
  if (writeRepoLink(gitDir, { apiUrl, projectId: who.project_id })) {
    deps.stdout(`This repo now uses project ${who.project_id}.`);
  } else {
    deps.stderr("Could not link this repo: its .git/codeceipt folder or link file is a symlink.");
  }
}

export const NOT_LINKED =
  "This repo is not linked to a Codeceipt project: run `npx codeceipt` here.";
const NO_TOKEN =
  "This repo is linked to a project this computer has no token for: run `npx codeceipt` here.";

/**
 * The project a command works on (D-020). In a git repo: the repo's linked project and that project's token, never
 * another repo's. Outside a git repo (nowhere to keep a link): the default `codeceipt login`.
 */
export async function projectConfig(
  deps: CliDeps,
  path: string,
  dir: string,
  opts: { linkedOnly?: boolean } = {},
): Promise<CliConfig> {
  const gitDir = await gitDirOf(deps.git ?? runGit, dir);
  if (!gitDir) {
    // D-021: the agents whose hooks or MCP server may start outside the repo use only a linked repo's token.
    if (opts.linkedOnly) throw new CliError(EXIT.auth, NOT_LINKED);
    // Inside a repo git cannot read (git missing, or "dubious ownership"), the default login is not this repo's
    // project: send nothing rather than another project's token.
    if (insideGitFolder(dir)) throw new CliError(EXIT.auth, GIT_UNREADABLE);
    const config = savedConfig(path);
    if (!config) throw new CliError(EXIT.auth, "Not logged in: run `codeceipt login` first.");
    return config;
  }
  const link = readRepoLink(gitDir);
  if (!link) throw new CliError(EXIT.auth, NOT_LINKED);
  // Real-test bug J: the link must belong to this repository (a copied .git, or a folder inside another repo, carries
  // another repo's link). A mismatch uploads nothing; an older link without a fingerprint gets this repo's once.
  const fingerprint = await repoFingerprint(deps.git ?? runGit, dir);
  if (link.fingerprint && !sameRepo(link.fingerprint, fingerprint)) {
    throw new CliError(EXIT.auth, REPO_MISMATCH_MESSAGE);
  }
  if (!link.fingerprint && (fingerprint.root || fingerprint.remote)) {
    writeRepoLink(gitDir, { ...link, fingerprint });
  }
  // The token may still be in the config folder from before the rename (D-019).
  const config = readProjectToken(path, link) ?? readProjectToken(legacyConfigPath(path), link);
  if (!config) throw new CliError(EXIT.auth, NO_TOKEN);
  return { ...config, repo: fingerprintToken(fingerprint) };
}

export const GIT_UNREADABLE =
  "Cannot read this repo's git folder (is git installed, and does git trust this folder?); nothing was sent.";

/** Whether `dir` or a folder above it is a git repository (.git/HEAD, or a .git file for worktrees and submodules). */
function insideGitFolder(dir: string): boolean {
  for (let d = resolve(dir); ; d = dirname(d)) {
    const dotGit = join(d, ".git");
    if (existsSync(join(dotGit, "HEAD"))) return true;
    try {
      if (statSync(dotGit).isFile()) return true;
    } catch {}
    if (dirname(d) === d) return false;
  }
}

// A login saved before the rename still counts until the next `codeceipt login` writes the new place.
const savedConfig = (path: string) => readConfig(path) ?? readConfig(legacyConfigPath(path));

// Returns the exit code (spec section 7); errors are one line on stderr, never a stack trace or the token.
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...args] = argv;
  const path = configPath(deps.env, deps.platform ?? process.platform, deps.homedir ?? osHomedir());
  try {
    if (command === "help" || command === "--help" || command === "-h") {
      deps.stdout(helpText());
      return EXIT.ok;
    }
    // No command (flags only): the one-command setup.
    if (command === undefined || command.startsWith("--")) {
      const args = argv.slice();
      const apiUrl = flag(args, "--api-url") ?? brandEnv(deps.env, "API_URL") ?? DEFAULT_API_URL;
      if (args.length > 0) throw new CliError(EXIT.usage, `Unknown argument: ${args[0]}`);
      if (!isSafeApiUrl(apiUrl)) {
        throw new CliError(
          EXIT.usage,
          "--api-url must be https (plain http only for localhost, 127.0.0.1 or [::1]).",
        );
      }
      await runSetup(apiUrl.replace(/\/+$/, ""), path, {
        fetch: deps.fetch,
        git: deps.git ?? runGit,
        cwd: deps.cwd,
        home: deps.homedir ?? osHomedir(),
        platform: deps.platform ?? process.platform,
        stdout: deps.stdout,
        sleep: deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
        ...(deps.openUrl ? { openUrl: deps.openUrl } : {}),
        hasCommand:
          deps.hasCommand ?? ((name) => onPath(name, deps.env, deps.platform ?? process.platform)),
      });
      return EXIT.ok;
    }
    if (command === "login") {
      await login(args, deps, path);
    } else if (command === "unlink") {
      if (args.length > 0) throw new CliError(EXIT.usage, "Usage: codeceipt unlink");
      const gitDir = await gitDirOf(deps.git ?? runGit, deps.cwd);
      const link = gitDir ? readRepoLink(gitDir) : null;
      if (!gitDir || !link || !removeRepoLink(gitDir)) {
        deps.stdout("This repo is not connected to a Codeceipt project; nothing to unlink.");
      } else {
        deps.stdout(
          `Disconnected this repo from project ${link.projectId}. Run \`npx codeceipt\` to connect it to a new or existing project.`,
        );
      }
      return EXIT.ok;
    } else if (command === "index") {
      // --rebuild: the stored index is cleared first, so files from another repo cannot survive (real-test bug J).
      const rebuild = args.includes("--rebuild");
      const rest = args.filter((a) => a !== "--rebuild");
      if (rest.length > 1)
        throw new CliError(EXIT.usage, "Usage: codeceipt index [--rebuild] [dir]");
      const dir = resolve(deps.cwd, rest[0] ?? ".");
      const config = await projectConfig(deps, path, dir);
      if (!isSafeApiUrl(config.apiUrl))
        throw new CliError(
          EXIT.usage,
          "Saved server address must be https (plain http only for localhost, 127.0.0.1 or [::1]): run `codeceipt login` again.",
        );
      if (rebuild) {
        const cleared = await request<{ removed: number }>(
          deps.fetch,
          config,
          "POST",
          `/api/index/${encodeURIComponent(config.projectId)}/rebuild`,
          {},
        );
        deps.stdout(
          `Cleared the stored index (${Number(cleared.removed) || 0} files); rebuilding it from this repo.`,
        );
      }
      await runIndex(deps.fetch, config, dir, deps.stdout, deps.homedir ?? osHomedir(), deps.sleep);
    } else if (command === "init") {
      const config = await projectConfig(deps, path, deps.cwd);
      if (!isSafeApiUrl(config.apiUrl))
        throw new CliError(
          EXIT.usage,
          "Saved server address must be https: run `codeceipt login` again.",
        );
      const root = await repoRoot(deps.git ?? runGit, deps.cwd).catch(() => deps.cwd);
      const result = runInit(
        root,
        deps.homedir ?? osHomedir(),
        config,
        args,
        deps.env.XDG_CONFIG_HOME,
      );
      for (const line of initReport(result, root, deps.cwd)) deps.stdout(line);
    } else if (command === "mcp-proxy") {
      // Cursor's MCP server (launch part 3): never fails; problems become MCP errors for Cursor to show.
      const linkedOnly = args.includes("--linked-only");
      const repo = flag(args, "--repo") ?? deps.cwd;
      const config = await projectConfig(deps, path, resolve(deps.cwd, repo), { linkedOnly }).then(
        (c) =>
          isSafeApiUrl(c.apiUrl)
            ? c
            : { problem: "The saved server address must be https: run `npx codeceipt` here." },
        (err: unknown) => ({
          problem: err instanceof CliError ? err.message : "Codeceipt is not set up here.",
        }),
      );
      await runMcpProxy(
        deps.stdinLines?.() ?? (async function* () {})(),
        config,
        deps.fetch,
        deps.stdout,
      );
      return EXIT.ok;
    } else if (command === "last") {
      const evidence = args.length === 1 && args[0] === "--evidence";
      if (args.length > 0 && !evidence) {
        throw new CliError(EXIT.usage, "Usage: codeceipt last [--evidence]");
      }
      return await runLast(deps, path, evidence);
    } else if (command === "receipt") {
      if (args.length > 0) throw new CliError(EXIT.usage, "Usage: codeceipt receipt");
      return await runReceipt(deps, path);
    } else if (command === "hook" && args[0] === "prompt") {
      return await runPromptHook(args, deps, path);
    } else if (command === "hook" && hookAgent(args) !== "claude" && hookAgent(args) !== "cursor") {
      return await runAgentHook(args, deps, path);
    } else if (command === "hook" || command === "mcp-headers") {
      // Hooks and the helper never fail: a repo without a project link gets one warning line instead.
      const resolved = await projectConfig(deps, path, deps.cwd).then(
        (config) => ({ config, problem: undefined }),
        (err: unknown) => ({
          config: null,
          problem: err instanceof CliError ? hookProblem(err.message) : undefined,
        }),
      );
      return await runHook(command, args, deps, resolved.config, resolved.problem);
    } else if (command === "scan-secrets") {
      // Runs offline: nothing is uploaded, so no login is needed.
      return await runScanSecrets(args, deps.cwd, deps.stdout, deps.git);
    } else {
      deps.stderr(helpText());
      return EXIT.usage;
    }
    return EXIT.ok;
  } catch (err) {
    if (err instanceof CliError) {
      deps.stderr(err.message);
      return err.exitCode;
    }
    deps.stderr(`Unexpected error: ${err instanceof Error ? err.name : "unknown"}`);
    return EXIT.failure;
  }
}

// Hooks and the headers helper never fail the agent's session: any error ends as one warning line and exit 0. A
// Claude Code session-end hook exits 2 when it has warnings, which is how Claude Code shows them to the user.
// The hook's one-line warning for a repo it cannot act for.
function hookProblem(message: string): string | undefined {
  if (message === NOT_LINKED)
    return "this repo is not linked to a Codeceipt project (run `npx codeceipt` here)";
  if (message === NO_TOKEN)
    return "this repo's project has no token on this computer (run `npx codeceipt` here)";
  if (message === GIT_UNREADABLE) return "git cannot read this repo, so no token was used";
  return undefined;
}

async function runHook(
  command: string,
  args: string[],
  deps: CliDeps,
  saved: CliConfig | null,
  problem: string | undefined,
): Promise<number> {
  const config = saved && isSafeApiUrl(saved.apiUrl) ? saved : null;
  const hookDeps = {
    fetch: deps.fetch,
    git: deps.git ?? runGit,
    cwd: deps.cwd,
    config,
    ...(problem ? { configProblem: problem } : {}),
    readStdin: deps.readStdin,
    env: deps.env,
    stdout: deps.stdout,
    stderr: deps.stderr,
  };
  try {
    if (command === "mcp-headers") {
      mcpHeaders({ ...hookDeps, env: deps.env });
      return EXIT.ok;
    }
    const [event] = args;
    const agent = hookAgent(args) === "cursor" ? "cursor" : "claude";
    if (event === "session-start") await sessionStart(agent, hookDeps);
    else if (event === "session-end") {
      // Exit 0 always: Claude Code labels a session-end hook that exits non-zero as "failed", and its docs give no
      // way to show a SessionEnd message without that label. The summary stays on stderr and `codeceipt last`.
      await sessionEnd(agent, hookDeps);
      return EXIT.ok;
    } else if (event === "stop") {
      // Owner, 2026-11-01: Claude finished responding (VS Code may never send SessionEnd): keep the receipt current.
      await sessionEnd(agent, hookDeps, { stop: true });
      return EXIT.ok;
    } else deps.stderr("Codeceipt: unknown hook (use session-start, session-end or stop).");
  } catch {
    deps.stderr("Codeceipt: the hook failed; the session goes on without it.");
  }
  return EXIT.ok;
}

// `--agent <name>`; Claude Code when missing or unknown (the hooks it installed before D-021 name no other agent).
function hookAgent(args: string[]): Agent {
  const i = args.indexOf("--agent");
  const name = i === -1 ? undefined : args[i + 1];
  return AGENTS.find((a) => a === name) ?? "claude";
}

// The folder the agent says the session is in: Codex and OpenCode send cwd, Antigravity workspacePaths. Only an
// absolute path counts; anything else means the hook's own folder.
function sessionFolder(stdin: string, fallback: string): string {
  try {
    const input = JSON.parse(stdin) as Record<string, unknown>;
    const paths = Array.isArray(input.workspacePaths)
      ? input.workspacePaths
      : Array.isArray(input.workspace_roots)
        ? input.workspace_roots
        : [];
    const claimed = typeof input.cwd === "string" ? input.cwd : paths[0];
    if (typeof claimed === "string" && isAbsolute(claimed)) return claimed;
  } catch {}
  return fallback;
}

// D-021 hooks for Codex, OpenCode and Antigravity. Their hooks may run outside the repo (Antigravity does not say
// where), so the repo comes from the session's own folder and only a linked repo's token is used, never the default
// login. Like the other hooks they never fail the agent's session.
async function runAgentHook(args: string[], deps: CliDeps, path: string): Promise<number> {
  const agent = hookAgent(args) as Exclude<Agent, "claude" | "cursor">;
  const [event] = args;
  let stdin = "";
  try {
    stdin = await deps.readStdin();
  } catch {}
  const dir = sessionFolder(stdin, deps.cwd);
  // Codex gives a SessionEnd hook 3 seconds at most: the same hook runs again in the background with --worker.
  if (
    agent === "codex" &&
    event === "session-end" &&
    !args.includes("--worker") &&
    deps.spawnBackground
  ) {
    try {
      deps.spawnBackground(["hook", "session-end", "--agent", "codex", "--worker"], stdin, dir);
    } catch {
      deps.stderr("Codeceipt: could not start the receipt in the background.");
    }
    return EXIT.ok;
  }
  const resolved = await projectConfig(deps, path, dir, { linkedOnly: true }).then(
    (config) => ({ config, problem: undefined }),
    (err: unknown) => ({
      config: null,
      problem: err instanceof CliError ? hookProblem(err.message) : undefined,
    }),
  );
  const config = resolved.config && isSafeApiUrl(resolved.config.apiUrl) ? resolved.config : null;
  const hookDeps = {
    fetch: deps.fetch,
    git: deps.git ?? runGit,
    cwd: dir,
    config,
    ...(resolved.problem ? { configProblem: resolved.problem } : {}),
    readStdin: async () => stdin,
    env: deps.env,
    stdout: deps.stdout,
    stderr: deps.stderr,
  };
  try {
    if (event === "session-start") await sessionStart(agent, hookDeps);
    else if (event === "session-end") await sessionEnd(agent, hookDeps);
    else deps.stderr("Codeceipt: unknown hook (use session-start or session-end).");
  } catch {
    deps.stderr("Codeceipt: the hook failed; the session goes on without it.");
  }
  return EXIT.ok;
}

// `codeceipt receipt`: the session end, run by hand (OpenCode and Antigravity have no session-end event). It covers
// the changes since the newest session start recorded in this repo, or since the last commit when there is none.
async function runReceipt(deps: CliDeps, path: string): Promise<number> {
  const config = await projectConfig(deps, path, deps.cwd, { linkedOnly: true });
  if (!isSafeApiUrl(config.apiUrl)) {
    throw new CliError(
      EXIT.usage,
      "Saved server address must be https: run `npx codeceipt` again.",
    );
  }
  const git = deps.git ?? runGit;
  const sessionId = await latestSession(git, deps.cwd).catch(() => null);
  let summary: { files: number; receiptId: string | null } | null = null;
  const warned = await sessionEnd("manual", {
    fetch: deps.fetch,
    git,
    cwd: deps.cwd,
    config,
    readStdin: async () => JSON.stringify(sessionId ? { session_id: sessionId } : {}),
    env: deps.env,
    stdout: deps.stdout,
    stderr: deps.stderr,
    done: (s) => {
      summary = s;
    },
  });
  const s = summary as { files: number; receiptId: string | null } | null;
  if (!s) return warned ? EXIT.server : EXIT.ok;
  const files = `${s.files} changed file${s.files === 1 ? "" : "s"}`;
  deps.stdout(
    s.receiptId
      ? `Receipt ${s.receiptId} saved for ${files}; progress saved.`
      : `No receipt (no open request, or no changed files); progress saved for ${files}.`,
  );
  return EXIT.ok;
}

// Dogfooding: Claude Code does not show a SessionEnd hook's output once the agent has exited, so the latest receipt's
// summary can be printed again here. Only counts are read from the server's answer (receiptSummary), never its text.
async function runLast(deps: CliDeps, path: string, evidence = false): Promise<number> {
  const config = await projectConfig(deps, path, deps.cwd);
  if (!isSafeApiUrl(config.apiUrl)) {
    throw new CliError(
      EXIT.usage,
      "Saved server address must be https: run `npx codeceipt` again.",
    );
  }
  const answer = await request<{ receipt_id?: unknown; created_at?: unknown; receipt?: unknown }>(
    deps.fetch,
    config,
    "GET",
    `/api/hooks/${encodeURIComponent(config.projectId)}/last-receipt`,
  );
  const receipt = answer.receipt;
  if (typeof receipt !== "object" || receipt === null) {
    deps.stdout("No receipt yet: make a change with your agent and end the session.");
    return EXIT.ok;
  }
  const id =
    typeof answer.receipt_id === "string" && /^[\w-]{1,64}$/.test(answer.receipt_id)
      ? answer.receipt_id
      : null;
  const at =
    typeof answer.created_at === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(answer.created_at)
      ? ` (${answer.created_at.slice(0, 16).replace("T", " ")} UTC)`
      : "";
  deps.stdout(`Latest receipt${at}:`);
  for (const line of receiptSummary(receipt as Record<string, unknown>, config, id))
    deps.stdout(line);
  for (const line of attentionLines(receipt as Record<string, unknown>)) deps.stdout(line);
  if (evidence)
    for (const line of evidenceLines(receipt as Record<string, unknown>)) deps.stdout(line);
  return EXIT.ok;
}

// Codeceipt's own commands typed as a prompt (`codeceipt last`, `npx codeceipt`, `!codeceipt ...`) are not requests.
const OWN_COMMAND = /^!?\s*(npx\s+)?codeceipt\b/i;
const PROMPT_TIMEOUT_MS = 20_000;

/**
 * `codeceipt hook prompt --agent <agent>`: the prompt-submit hook (Claude Code and Codex UserPromptSubmit, Cursor
 * beforeSubmitPrompt, OpenCode's plugin). It records the user's request for this session and adds nothing to the
 * agent's context: it prints nothing (Cursor gets {"continue":true}, so the prompt is never blocked) and always exits
 * 0. Empty prompts, slash commands and Codeceipt's own commands are skipped. The request goes out masked and capped,
 * in the background (`--worker`), so the prompt never waits for it; only a linked repo's token is used.
 */
// The folder on stdin is not used when it is in a different repo from the one the hook runs in, so a prompt is never
// sent to another linked repo's project (a hook run outside any repo, like OpenCode's plugin, uses it).
async function promptFolder(deps: CliDeps, claimed: string): Promise<string> {
  const git = deps.git ?? runGit;
  const own = await repoRoot(git, deps.cwd).catch(() => null);
  if (own === null) return claimed;
  const other = await repoRoot(git, claimed).catch(() => null);
  return other === null || other === own ? claimed : deps.cwd;
}

async function runPromptHook(args: string[], deps: CliDeps, path: string): Promise<number> {
  const agent = hookAgent(args);
  const answer = () => {
    if (agent === "cursor") deps.stdout(JSON.stringify({ continue: true }));
    return EXIT.ok;
  };
  let stdin = "";
  try {
    stdin = await deps.readStdin();
  } catch {}
  let input: Record<string, unknown> = {};
  try {
    const parsed: unknown = stdin.length <= 1024 * 1024 ? JSON.parse(stdin) : null;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      input = parsed as Record<string, unknown>;
    }
  } catch {}
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (prompt === "" || prompt.startsWith("/") || OWN_COMMAND.test(prompt)) return answer();
  const dir = await promptFolder(deps, sessionFolder(stdin, deps.cwd));
  if (!args.includes("--worker") && deps.spawnBackground) {
    try {
      deps.spawnBackground(["hook", "prompt", "--agent", agent, "--worker"], stdin, dir);
    } catch {}
    return answer();
  }
  try {
    const config = await projectConfig(deps, path, dir, { linkedOnly: true });
    if (isSafeApiUrl(config.apiUrl)) {
      await request(
        (url, init) => deps.fetch(url, { ...init, signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS) }),
        config,
        "POST",
        `/api/hooks/${encodeURIComponent(config.projectId)}/requests`,
        {
          text: maskSecretsIn(prompt).slice(0, MAX_REQUEST_CHARS),
          session_id: sessionIdOf(input),
        },
      );
    }
  } catch {
    // Never fails the agent's prompt: an unlinked repo or an unreachable server records nothing.
  }
  return answer();
}
