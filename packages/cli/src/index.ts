import { homedir as osHomedir } from "node:os";
import { resolve } from "node:path";
import { CliError, EXIT, request } from "./api";
import { configPath, readConfig, writeConfig } from "./config";
import { mcpHeaders, sessionEnd, sessionStart } from "./hooks";
import { runIndex } from "./index-command";
import { initReport, runInit } from "./init-command";
import { type Git, repoRoot, runGit, runScanSecrets } from "./scan-secrets";

export const PACKAGE = "@brain/cli";
export const VERSION = "0.0.0";
const DEFAULT_API_URL = "http://localhost:3000";

export function helpText(): string {
  return [
    `projectbrain ${VERSION}`,
    "  projectbrain login [--api-url <url>]   reads the project token from stdin or PROJECTBRAIN_TOKEN",
    "  projectbrain index [dir]               indexes the repo locally and uploads metadata only",
    "  projectbrain scan-secrets [files...]   scans changed (or named) files for secrets; prints masked findings",
    "  projectbrain init [--claude] [--cursor] sets up Claude Code and Cursor (MCP config, hooks, Skill, AGENTS.md)",
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
  // Waits between 429 retries; tests inject one that does not really wait.
  sleep?: (ms: number) => Promise<void>;
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
  const apiUrl = flag(args, "--api-url") ?? deps.env.PROJECTBRAIN_API_URL ?? DEFAULT_API_URL;
  if (args.length > 0) throw new CliError(EXIT.usage, `Unknown argument: ${args[0]}`);
  if (!isSafeApiUrl(apiUrl))
    throw new CliError(
      EXIT.usage,
      "--api-url must be https (plain http only for localhost, 127.0.0.1 or [::1]).",
    );
  const token = (deps.env.PROJECTBRAIN_TOKEN ?? (await deps.readStdin())).trim();
  if (!token)
    throw new CliError(EXIT.usage, "No token: paste it on stdin or set PROJECTBRAIN_TOKEN.");
  const who = await request<{ project_id: string }>(
    deps.fetch,
    { apiUrl, token },
    "GET",
    "/api/token/whoami",
  );
  writeConfig(path, { apiUrl, projectId: who.project_id, token });
  deps.stdout(`Logged in as project ${who.project_id}`);
}

// Returns the exit code (spec section 7); errors are one line on stderr, never a stack trace or the token.
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...args] = argv;
  const path = configPath(deps.env, deps.platform ?? process.platform, deps.homedir ?? osHomedir());
  try {
    if (command === "login") {
      await login(args, deps, path);
    } else if (command === "index") {
      if (args.length > 1) throw new CliError(EXIT.usage, "Usage: projectbrain index [dir]");
      const config = readConfig(path);
      if (!config) throw new CliError(EXIT.auth, "Not logged in: run `projectbrain login` first.");
      if (!isSafeApiUrl(config.apiUrl))
        throw new CliError(
          EXIT.usage,
          "Saved server address must be https (plain http only for localhost, 127.0.0.1 or [::1]): run `projectbrain login` again.",
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
      const config = readConfig(path);
      if (!config) throw new CliError(EXIT.auth, "Not logged in: run `projectbrain login` first.");
      if (!isSafeApiUrl(config.apiUrl))
        throw new CliError(
          EXIT.usage,
          "Saved server address must be https: run `projectbrain login` again.",
        );
      const root = await repoRoot(deps.git ?? runGit, deps.cwd).catch(() => deps.cwd);
      const result = runInit(root, deps.homedir ?? osHomedir(), config, args);
      for (const line of initReport(result, root, deps.cwd)) deps.stdout(line);
    } else if (command === "hook" || command === "mcp-headers") {
      return await runHook(command, args, deps, path);
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
async function runHook(
  command: string,
  args: string[],
  deps: CliDeps,
  path: string,
): Promise<number> {
  const saved = readConfig(path);
  const config = saved && isSafeApiUrl(saved.apiUrl) ? saved : null;
  const hookDeps = {
    fetch: deps.fetch,
    git: deps.git ?? runGit,
    cwd: deps.cwd,
    config,
    readStdin: deps.readStdin,
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
    } else deps.stderr("Project Brain: unknown hook (use session-start or session-end).");
  } catch {
    deps.stderr("Project Brain: the hook failed; the session goes on without it.");
  }
  return EXIT.ok;
}
