import { existsSync, realpathSync, statSync } from "node:fs";
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
import { DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S, MIN_TIMEOUT_S, checkKey, runCheck } from "./check-run";
import {
  type CliConfig,
  configPath,
  hasAnyLogin,
  legacyConfigPath,
  readConfig,
  readProjectToken,
  readSettings,
  saveProjectToken,
  writeConfig,
  writeSettings,
} from "./config";
import { hookRunsFile, recordHookRun } from "./hook-runs";
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
import { configCommand, updateCommand } from "./native/commands";
import { codeceiptsOnPath, runDoctor } from "./native/doctor";
import { installKind } from "./native/install-info";
import { applyOwnerStates, ownerStateLines } from "./owner-states";
import { PLUGIN_MARKETPLACE } from "./plugins";
import { removeRepoFiles } from "./remove-repo-files";
import {
  gitDirOf,
  readRepoLink,
  removeRepoLink,
  repoFingerprint,
  writeRepoLink,
} from "./repo-link";
import { type Git, repoRoot, runGit, runScanSecrets } from "./scan-secrets";
import { onPath, runSetup } from "./setup-command";
import { GATE_HEADER } from "./stop-gate";
import { CLI_VERSION, hookPathFor, setHookInstallPath } from "./templates";

export const PACKAGE = "@brain/cli";
// Also the version the hooks' npx fallback is pinned to (templates.ts CLI_VERSION; a test keeps them equal).
export const VERSION = CLI_VERSION;
// The hosted Codeceipt; --api-url or CODECEIPT_API_URL points the CLI elsewhere (for example http://localhost:3000).
export const DEFAULT_API_URL = "https://codeceipts.vercel.app";

export function helpText(): string {
  return [
    `codeceipt ${VERSION}: A receipt for every AI change.`,
    "  codeceipt                           connects this repo: approve a code in your browser, then index and set up agents",
    "  codeceipt connect                   the same, by name (agents with the Codeceipt plugin get nothing written into the repo)",
    "  codeceipt login [--api-url <url>]   reads the project token from stdin or CODECEIPT_TOKEN",
    "  codeceipt index [dir]               indexes the repo locally and uploads metadata only",
    "  codeceipt index --rebuild [dir]     clears the project's stored index and rebuilds it from this repo only",
    "  codeceipt unlink                    disconnects this repo from its project (run npx codeceipt to connect again)",
    "  codeceipt scan-secrets [files...]   scans changed (or named) files for secrets; prints masked findings",
    "  codeceipt init [--claude] [--cursor] [--codex] [--opencode] [--antigravity]",
    "                                      sets up the agents found here (MCP config, hooks, skill or rule, AGENTS.md)",
    "  codeceipt init --remove-repo-files  removes those files for agents whose Codeceipt plugin is installed",
    "  codeceipt receipt                   saves a receipt and progress now (for agents with no session-end event)",
    "  codeceipt last                      prints the latest receipt's summary and link again",
    "  codeceipt last --evidence           also prints the code-free evidence the judge was given, per file",
    "  codeceipt doctor                    checks the install, login, repo link, hooks and network, with the fix for each problem",
    "  codeceipt update                    updates the native app now (it also checks by itself once a day)",
    "  codeceipt config auto-update on|off turns the daily automatic update on or off",
    "  codeceipt --version                 prints the version",
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
  // D-027: where this copy runs from (the native binary, or node + the bundled script); tests inject them.
  execPath?: string;
  scriptPath?: string;
  git?: Git;
  // D-028: a yes/no question in the terminal (absent without one), and an agent's own command run without a shell.
  ask?: (question: string) => Promise<boolean>;
  runCommand?: (command: string, args: string[]) => Promise<boolean>;
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

/**
 * D-027: the path hooks should call: the native binary itself, or a global npm install's codeceipt on PATH. A one-off
 * npx run or a source checkout has no lasting path (null: hooks look codeceipt up on PATH, then use the pinned npx).
 */
function currentHookPath(deps: CliDeps): string | null {
  const home = deps.homedir ?? osHomedir();
  const platform = deps.platform ?? process.platform;
  const kind = installKind(deps.scriptPath ?? process.argv[1]);
  if (kind === "native") return hookPathFor(deps.execPath ?? process.execPath, home);
  if (kind !== "npm") return null;
  const npmBin = codeceiptsOnPath(deps.env, platform).find((p) => {
    try {
      return /[\\/]node_modules[\\/]codeceipt[\\/]/.test(realpathSync(p));
    } catch {
      return false;
    }
  });
  return npmBin ? hookPathFor(npmBin, home) : null;
}

// Returns the exit code (spec section 7); errors are one line on stderr, never a stack trace or the token.
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...args] = argv;
  const path = configPath(deps.env, deps.platform ?? process.platform, deps.homedir ?? osHomedir());
  try {
    if (command === "help" || command === "--help" || command === "-h") {
      deps.stdout(helpText());
      return EXIT.ok;
    }
    // D-027: hooks written by this run call this install by its full path.
    setHookInstallPath(currentHookPath(deps));
    if (command === "doctor") {
      if (args.length > 0) throw new CliError(EXIT.usage, "Usage: codeceipt doctor");
      return await runDoctor({
        fetch: deps.fetch,
        env: deps.env,
        cwd: deps.cwd,
        home: deps.homedir ?? osHomedir(),
        platform: deps.platform ?? process.platform,
        execPath: deps.execPath ?? process.execPath,
        scriptPath: deps.scriptPath ?? process.argv[1],
        version: VERSION,
        configFile: path,
        defaultApiUrl: brandEnv(deps.env, "API_URL") ?? DEFAULT_API_URL,
        stdout: deps.stdout,
        repoProject: () => projectConfig(deps, path, deps.cwd),
        inGitRepo: async () => (await gitDirOf(deps.git ?? runGit, deps.cwd)) !== null,
        hasLogin: () => hasAnyLogin(path),
        repoRoot: () => repoRoot(deps.git ?? runGit, deps.cwd).catch(() => null),
      });
    }
    // D-027: exactly `codeceipt <version>` (the self-updater runs a new file with --version to check it).
    if (command === "--version" || command === "-v" || command === "version") {
      deps.stdout(`codeceipt ${VERSION}`);
      return EXIT.ok;
    }
    if (command === "config") {
      if (args[0] === "check" || args[0] === "check-timeout") {
        return await checkConfig(args, path, deps);
      }
      configCommand(args, path, deps);
      return EXIT.ok;
    }
    if (command === "check-run") return await runCheckCommand(args, deps, path);
    if (command === "update") {
      return await updateCommand(args, path, deps, {
        fetch: deps.fetch,
        platform: deps.platform ?? process.platform,
        scriptPath: deps.scriptPath ?? process.argv[1],
        execPath: deps.execPath ?? process.execPath,
        version: VERSION,
      });
    }
    // No command (flags only): the one-command setup.
    // D-028: `codeceipt connect` is the same setup by name.
    if (command === undefined || command.startsWith("--") || command === "connect") {
      const args = command === "connect" ? argv.slice(1) : argv.slice();
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
        native: installKind(deps.scriptPath ?? process.argv[1]) === "native",
        marketplace: PLUGIN_MARKETPLACE,
        ...(deps.ask ? { ask: deps.ask } : {}),
        ...(deps.runCommand ? { run: deps.runCommand } : {}),
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
      // D-028: once an agent's plugin is installed, the repo's own files for it can go.
      if (args.includes("--remove-repo-files")) {
        if (args.length > 1)
          throw new CliError(EXIT.usage, "Usage: codeceipt init --remove-repo-files");
        for (const line of removeRepoFiles(root, deps.homedir ?? osHomedir())) deps.stdout(line);
        return EXIT.ok;
      }
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
    } else if (command === "hook") {
      // D-028: --plugin marks a plugin's hook (installed for every repo on the machine).
      return await runAnyHook(
        args.filter((a) => a !== "--plugin"),
        deps,
        path,
        args.includes("--plugin"),
      );
    } else if (command === "mcp-headers") {
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

// Every hook: records the run for `codeceipt doctor` (D-028), then runs it. A plugin's hook in a repo that is not
// linked to a project ends here without a word: the plugin runs in every repo on the computer.
async function runAnyHook(
  args: string[],
  deps: CliDeps,
  path: string,
  plugin: boolean,
): Promise<number> {
  const agent = hookAgent(args);
  const [event] = args;
  let stdin: string | null = null;
  const input = async () => {
    if (stdin === null) {
      try {
        stdin = await deps.readStdin();
      } catch {
        stdin = "";
      }
    }
    return stdin;
  };
  const folder =
    agent === "claude" || agent === "cursor" ? deps.cwd : sessionFolder(await input(), deps.cwd);
  const hookDeps: CliDeps = { ...deps, readStdin: input };
  if (plugin) {
    const linked = await projectConfig(deps, path, folder, { linkedOnly: true }).then(
      () => true,
      // Linked, but this computer has no token for its project: that one warning is worth showing.
      (err: unknown) => err instanceof CliError && err.message === NO_TOKEN,
    );
    if (!linked) {
      if (event === "prompt" && agent === "cursor") deps.stdout(JSON.stringify({ continue: true }));
      return EXIT.ok;
    }
  }
  if (event && !args.includes("--worker")) {
    const git = deps.git ?? runGit;
    const root = await repoRoot(git, folder).catch(() => folder);
    recordHookRun(hookRunsFile(path), agent, event, root, plugin);
  }
  if (event === "prompt") return await runPromptHook(args, hookDeps, path);
  if (agent !== "claude" && agent !== "cursor") return await runAgentHook(args, hookDeps, path);
  const resolved = await projectConfig(hookDeps, path, deps.cwd).then(
    (config) => ({ config, problem: undefined }),
    (err: unknown) => ({
      config: null,
      problem: err instanceof CliError ? hookProblem(err.message) : undefined,
    }),
  );
  return await runHook("hook", args, hookDeps, resolved.config, resolved.problem, {
    stopGate: readSettings(path).stopGate !== false,
    ...(await checkStarter(deps, path, deps.cwd)),
  });
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
  settings: { stopGate?: boolean; startCheck?: (receiptId: string) => void } = {},
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
    ...(settings.stopGate ? { stopGate: true } : {}),
    ...(settings.startCheck ? { startCheck: settings.startCheck } : {}),
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
    ...(await checkStarter(deps, path, dir)),
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
  const answer = await request<{
    receipt_id?: unknown;
    created_at?: unknown;
    receipt?: unknown;
    owner_closed_ids?: unknown;
    dismissed_ids?: unknown;
  }>(deps.fetch, config, "GET", `/api/hooks/${encodeURIComponent(config.projectId)}/last-receipt`);
  const stored = answer.receipt;
  if (typeof stored !== "object" || stored === null) {
    deps.stdout("No receipt yet: make a change with your agent and end the session.");
    return EXIT.ok;
  }
  // The owner's closes and dismissals since the receipt was written: labelled, never counted as missed.
  const receipt = applyOwnerStates(
    stored as Record<string, unknown>,
    answer.owner_closed_ids,
    answer.dismissed_ids,
  );
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
  for (const line of receiptSummary(receipt, config, id)) deps.stdout(line);
  for (const line of ownerStateLines(receipt)) deps.stdout(line);
  for (const line of attentionLines(receipt)) deps.stdout(line);
  if (evidence) for (const line of evidenceLines(receipt)) deps.stdout(line);
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
  // FEAT-020: the Stop gate's own instruction, which Cursor sends back as a follow-up prompt, is never a request.
  if (
    prompt === "" ||
    prompt.startsWith("/") ||
    OWN_COMMAND.test(prompt) ||
    prompt.startsWith(GATE_HEADER)
  )
    return answer();
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

// FEAT-022: the repo's check command (set with `codeceipt config check`), from the user config only. The key is the
// repo's top folder; a repo cannot set or change it.
async function repoCheck(deps: CliDeps, path: string, folder: string) {
  const root = await repoRoot(deps.git ?? runGit, folder).catch(() => null);
  if (!root) return null;
  const setting = readSettings(path).checks?.[checkKey(root)];
  return setting ? { root, ...setting } : null;
}

// The session end starts `codeceipt check-run` in the background (a hook may run for 60 s at most).
async function checkStarter(deps: CliDeps, path: string, folder: string) {
  const check = await repoCheck(deps, path, folder).catch(() => null);
  if (!check || !deps.spawnBackground) return {};
  const spawnBackground = deps.spawnBackground;
  return {
    startCheck: (receiptId: string) => {
      try {
        spawnBackground(["check-run", "--receipt", receiptId], "", check.root);
      } catch {}
    },
  };
}

/** `codeceipt config check ["<command>"|off]` and `codeceipt config check-timeout <seconds>`, for this repo. */
async function checkConfig(args: string[], path: string, deps: CliDeps): Promise<number> {
  const root = await repoRoot(deps.git ?? runGit, deps.cwd).catch(() => null);
  if (!root) throw new CliError(EXIT.usage, "Run this inside your app's git repository.");
  const key = checkKey(root);
  const checks = { ...(readSettings(path).checks ?? {}) };
  const [what, value, ...rest] = args;
  if (rest.length > 0) {
    throw new CliError(
      EXIT.usage,
      'Usage: codeceipt config check ["<command>"|off] | check-timeout <seconds>',
    );
  }
  if (what === "check-timeout") {
    const secs = Number(value);
    if (!Number.isInteger(secs) || secs < MIN_TIMEOUT_S || secs > MAX_TIMEOUT_S) {
      throw new CliError(
        EXIT.usage,
        `Usage: codeceipt config check-timeout <seconds> (${MIN_TIMEOUT_S} to ${MAX_TIMEOUT_S})`,
      );
    }
    const current = checks[key];
    if (!current)
      throw new CliError(EXIT.usage, 'Set the command first: codeceipt config check "npm test"');
    checks[key] = { ...current, timeoutSec: secs };
    writeSettings(path, { checks });
    deps.stdout(`The check command for this repo stops after ${secs} s.`);
    return EXIT.ok;
  }
  if (value === undefined) {
    const current = checks[key];
    deps.stdout(
      current
        ? `Check command for this repo: ${current.command} (stops after ${current.timeoutSec ?? DEFAULT_TIMEOUT_S} s)`
        : 'No check command for this repo. Set one with: codeceipt config check "npm test"',
    );
    return EXIT.ok;
  }
  if (value === "off") {
    delete checks[key];
    writeSettings(path, { checks });
    deps.stdout("No check command for this repo any more; receipts say 'not run'.");
    return EXIT.ok;
  }
  if (value.trim() === "" || value.length > 2000) {
    throw new CliError(EXIT.usage, "The check command must be 1 to 2000 characters.");
  }
  checks[key] = {
    command: value,
    ...(checks[key]?.timeoutSec ? { timeoutSec: checks[key]?.timeoutSec } : {}),
  };
  writeSettings(path, { checks });
  deps.stdout(`Check command for this repo: ${value}`);
  deps.stdout(
    "It runs on this computer after each agent session; only passed/failed, the time and test counts are sent.",
  );
  return EXIT.ok;
}

/** `codeceipt check-run --receipt <id>`: runs this repo's check command and posts only the result. */
async function runCheckCommand(args: string[], deps: CliDeps, path: string): Promise<number> {
  const receiptId = flag(args, "--receipt");
  if (!receiptId || !/^[\w-]{1,64}$/.test(receiptId)) {
    throw new CliError(EXIT.usage, "Usage: codeceipt check-run --receipt <receipt id>");
  }
  const check = await repoCheck(deps, path, deps.cwd);
  if (!check) return EXIT.ok;
  const config = await projectConfig(deps, path, check.root, { linkedOnly: true }).catch(
    () => null,
  );
  if (!config || !isSafeApiUrl(config.apiUrl)) return EXIT.ok;
  const result = await runCheck({
    command: check.command,
    cwd: check.root,
    timeoutMs: (check.timeoutSec ?? DEFAULT_TIMEOUT_S) * 1000,
    platform: deps.platform ?? process.platform,
  });
  try {
    await request(
      deps.fetch,
      config,
      "POST",
      `/api/hooks/${encodeURIComponent(config.projectId)}/check-run`,
      {
        receipt_id: receiptId,
        ...result,
      },
    );
  } catch {}
  return EXIT.ok;
}
