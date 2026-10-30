import { homedir as osHomedir } from "node:os";
import { resolve } from "node:path";
import { brandEnv } from "@brain/core";
import { CliError, EXIT, request } from "./api";
import {
  type CliConfig,
  configPath,
  legacyConfigPath,
  readConfig,
  readProjectToken,
  saveProjectToken,
  writeConfig,
} from "./config";
import { mcpHeaders, sessionEnd, sessionStart } from "./hooks";
import { runIndex } from "./index-command";
import { initReport, runInit } from "./init-command";
import { runMcpProxy } from "./mcp-proxy";
import { gitDirOf, readRepoLink, writeRepoLink } from "./repo-link";
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
    "  codeceipt scan-secrets [files...]   scans changed (or named) files for secrets; prints masked findings",
    "  codeceipt init [--claude] [--cursor] sets up Claude Code and Cursor (MCP config, hooks, Skill, AGENTS.md)",
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
export async function projectConfig(deps: CliDeps, path: string, dir: string): Promise<CliConfig> {
  const gitDir = await gitDirOf(deps.git ?? runGit, dir);
  if (!gitDir) {
    const config = savedConfig(path);
    if (!config) throw new CliError(EXIT.auth, "Not logged in: run `codeceipt login` first.");
    return config;
  }
  const link = readRepoLink(gitDir);
  if (!link) throw new CliError(EXIT.auth, NOT_LINKED);
  // The token may still be in the config folder from before the rename (D-019).
  const config = readProjectToken(path, link) ?? readProjectToken(legacyConfigPath(path), link);
  if (!config) throw new CliError(EXIT.auth, NO_TOKEN);
  return config;
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
    } else if (command === "index") {
      if (args.length > 1) throw new CliError(EXIT.usage, "Usage: codeceipt index [dir]");
      const config = await projectConfig(deps, path, resolve(deps.cwd, args[0] ?? "."));
      if (!isSafeApiUrl(config.apiUrl))
        throw new CliError(
          EXIT.usage,
          "Saved server address must be https (plain http only for localhost, 127.0.0.1 or [::1]): run `codeceipt login` again.",
        );
      await runIndex(
        deps.fetch,
        config,
        resolve(deps.cwd, args[0] ?? "."),
        deps.stdout,
        deps.homedir ?? osHomedir(),
        deps.sleep,
      );
    } else if (command === "init") {
      const config = await projectConfig(deps, path, deps.cwd);
      if (!isSafeApiUrl(config.apiUrl))
        throw new CliError(
          EXIT.usage,
          "Saved server address must be https: run `codeceipt login` again.",
        );
      const root = await repoRoot(deps.git ?? runGit, deps.cwd).catch(() => deps.cwd);
      const result = runInit(root, deps.homedir ?? osHomedir(), config, args);
      for (const line of initReport(result, root, deps.cwd)) deps.stdout(line);
    } else if (command === "mcp-proxy") {
      // Cursor's MCP server (launch part 3): never fails; problems become MCP errors for Cursor to show.
      const repo = flag(args, "--repo") ?? deps.cwd;
      const config = await projectConfig(deps, path, resolve(deps.cwd, repo)).then(
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
    const [event, flag, agentArg] = args;
    const agent = flag === "--agent" && agentArg === "cursor" ? "cursor" : "claude";
    if (event === "session-start") await sessionStart(agent, hookDeps);
    else if (event === "session-end") {
      const warned = await sessionEnd(agent, hookDeps);
      return warned && agent === "claude" ? 2 : EXIT.ok;
    } else deps.stderr("Codeceipt: unknown hook (use session-start or session-end).");
  } catch {
    deps.stderr("Codeceipt: the hook failed; the session goes on without it.");
  }
  return EXIT.ok;
}
