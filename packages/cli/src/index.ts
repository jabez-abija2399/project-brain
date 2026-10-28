import { homedir as osHomedir } from "node:os";
import { resolve } from "node:path";
import { CliError, EXIT, request } from "./api";
import { configPath, readConfig, writeConfig } from "./config";
import { runIndex } from "./index-command";

export const PACKAGE = "@brain/cli";
export const VERSION = "0.0.0";
const DEFAULT_API_URL = "http://localhost:3000";

export function helpText(): string {
  return [
    `projectbrain ${VERSION}`,
    "  projectbrain login [--api-url <url>]   reads the project token from stdin or PROJECTBRAIN_TOKEN",
    "  projectbrain index [dir]               indexes the repo locally and uploads metadata only",
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
      await runIndex(deps.fetch, config, resolve(deps.cwd, args[0] ?? "."), deps.stdout);
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
