import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
import { CliError, EXIT, MAX_RESPONSE_BYTES, readCapped, request } from "./api";
import { type CliConfig, readProjectToken, saveProjectToken } from "./config";
import { runIndex } from "./index-command";
import { runInit } from "./init-command";
import { gitDirOf, readRepoLink, writeRepoLink } from "./repo-link";
import { type Git, repoRoot } from "./scan-secrets";

// Launch part 1: `npx codeceipt` with no arguments. Gets a project token through the browser (device approval: a short
// code in the terminal and on the page), links this repo to the project, indexes it and runs init, then prints one
// short summary.
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type SetupDeps = {
  fetch: Fetch;
  git: Git;
  cwd: string;
  home: string;
  platform: NodeJS.Platform;
  stdout: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  openUrl?: (url: string) => Promise<boolean>;
  /** Whether a command is installed; the agents run `codeceipt`, which `npx` alone does not install. */
  hasCommand?: (name: string) => boolean;
};

const MAX_WAIT_S = 600;
const MIN_INTERVAL_S = 5;
const USER_CODE = /^[A-Z]{4}-[A-Z]{4}$/;

/** Whether `name` is a file in one of the PATH folders (with a PATHEXT extension on Windows). */
export function onPath(
  name: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): boolean {
  const path = env.PATH ?? env.Path ?? "";
  const exts =
    platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  return path
    .split(platform === "win32" ? ";" : delimiter)
    .filter(Boolean)
    .some((dir) =>
      exts.some((ext) => {
        try {
          return statSync(join(dir, name + ext.toLowerCase())).isFile();
        } catch {
          return false;
        }
      }),
    );
}

/** Opens the address in the default browser; false when no browser could be started. */
export function openBrowser(url: string, platform: NodeJS.Platform): Promise<boolean> {
  const [cmd, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      // No shell: the address is one argument, never parsed by a shell.
      const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

async function postJson(fetchImpl: Fetch, url: string, body: unknown) {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CliError(EXIT.server, `Cannot reach ${new URL(url).origin}.`);
  }
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse((await readCapped(res, MAX_RESPONSE_BYTES)) ?? "{}");
  } catch {}
  return { status: res.status, json };
}

/** The device flow: a code shown here and in the browser; returns the project token once the owner approves it. */
async function approveInBrowser(apiUrl: string, root: string, deps: SetupDeps): Promise<CliConfig> {
  const start = await postJson(deps.fetch, `${apiUrl}/api/device/start`, { name: basename(root) });
  const deviceCode = start.json.device_code;
  const userCode = start.json.user_code;
  if (
    start.status !== 200 ||
    typeof deviceCode !== "string" ||
    typeof userCode !== "string" ||
    !USER_CODE.test(userCode)
  ) {
    throw new CliError(
      start.status === 429 ? EXIT.server : EXIT.failure,
      start.status === 429
        ? "Too many requests: try again in a minute."
        : "The server did not give a code. Try again later.",
    );
  }
  // The page address is built here from the server we talk to; an address in the answer is never opened.
  const url = `${apiUrl}/device?code=${userCode}`;
  deps.stdout(`Your code: ${userCode}`);
  const opened = await (deps.openUrl ?? ((u) => openBrowser(u, deps.platform)))(url).catch(
    () => false,
  );
  deps.stdout(
    opened
      ? `Opened the approval page in your browser: ${url}`
      : `Open this address in your browser: ${url}`,
  );
  deps.stdout("Waiting for approval...");
  const ttl =
    typeof start.json.expires_in === "number"
      ? Math.min(start.json.expires_in, MAX_WAIT_S)
      : MAX_WAIT_S;
  let interval =
    typeof start.json.interval === "number"
      ? Math.max(start.json.interval, MIN_INTERVAL_S)
      : MIN_INTERVAL_S;
  for (let waited = 0; waited <= ttl; ) {
    await deps.sleep(interval * 1000);
    waited += interval;
    const poll = await postJson(deps.fetch, `${apiUrl}/api/device/token`, {
      device_code: deviceCode,
    });
    if (poll.status === 200) {
      const token = poll.json.access_token;
      const projectId = poll.json.project_id;
      if (
        typeof token !== "string" ||
        typeof projectId !== "string" ||
        !/^[A-Za-z0-9_-]{1,100}$/.test(projectId)
      ) {
        throw new CliError(EXIT.failure, "The server's answer was unreadable. Try again.");
      }
      return { apiUrl, projectId, token };
    }
    const error = poll.json.error;
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval += 5;
      continue;
    }
    if (error === "access_denied") {
      throw new CliError(EXIT.auth, "The code was denied in the browser; nothing was connected.");
    }
    if (error === "token_limit") {
      throw new CliError(
        EXIT.auth,
        "That project already has 20 active tokens: revoke one on its page in the dashboard, then run `npx codeceipt` again.",
      );
    }
    if (error === "expired_token" || error === "invalid_grant") break;
    if (poll.status === 429) {
      interval += 5;
      continue;
    }
    throw new CliError(EXIT.server, `The server failed (${poll.status}). Try again later.`);
  }
  throw new CliError(
    EXIT.auth,
    "The code expired before it was approved: run `npx codeceipt` again.",
  );
}

/** A linked repo whose token still works needs no new code. */
async function existingConfig(
  path: string,
  gitDir: string,
  apiUrl: string,
  fetchImpl: Fetch,
): Promise<CliConfig | null> {
  const link = readRepoLink(gitDir);
  if (!link || new URL(link.apiUrl).origin !== new URL(apiUrl).origin) return null;
  const config = readProjectToken(path, link);
  if (!config) return null;
  try {
    await request<{ project_id: string }>(fetchImpl, config, "GET", "/api/token/whoami");
    return config;
  } catch {
    return null;
  }
}

export async function runSetup(apiUrl: string, configFile: string, deps: SetupDeps): Promise<void> {
  const root = await repoRoot(deps.git, deps.cwd).catch(() => null);
  const gitDir = root ? await gitDirOf(deps.git, root) : null;
  if (!root || !gitDir) {
    throw new CliError(
      EXIT.usage,
      "Run `npx codeceipt` inside your app's git repository (run `git init` there first if it has none).",
    );
  }
  let config = await existingConfig(configFile, gitDir, apiUrl, deps.fetch);
  if (config) {
    deps.stdout(`This repo is already connected to project ${config.projectId}.`);
  } else {
    config = await approveInBrowser(apiUrl, root, deps);
    saveProjectToken(configFile, config);
    if (!writeRepoLink(gitDir, { apiUrl, projectId: config.projectId })) {
      throw new CliError(
        EXIT.failure,
        "Could not link this repo: its .git/codeceipt folder or link file is a symlink.",
      );
    }
  }

  // Index and init print their details into a list; only the summary is shown.
  const detail: string[] = [];
  await runIndex(deps.fetch, config, root, (l) => detail.push(l), deps.home, deps.sleep);
  const files = detail.join("\n").match(/Indexing (\d+) files/)?.[1] ?? "0";
  const features = detail.join("\n").match(/Grouped into (\d+) features/)?.[1];
  let agents: string;
  try {
    const init = runInit(root, deps.home, config, []);
    agents = init.agents.map((a) => (a === "claude" ? "Claude Code" : "Cursor")).join(" and ");
  } catch {
    agents = "none found here (run `codeceipt init --claude` or `codeceipt init --cursor`)";
  }
  deps.stdout("Codeceipt is set up for this repo.");
  deps.stdout(`  Project: ${apiUrl}/projects/${config.projectId}`);
  deps.stdout(
    `  Indexed: ${files} file${files === "1" ? "" : "s"}${features ? `, ${features} features` : ""}`,
  );
  deps.stdout(`  Agents:  ${agents}`);
  deps.stdout(
    "  Next:    start a Claude Code or Cursor session here; receipts appear in your dashboard.",
  );
  if (deps.hasCommand && !deps.hasCommand("codeceipt")) {
    deps.stdout("  Install: npm install -g codeceipt (your agents run the codeceipt command)");
  }
}
