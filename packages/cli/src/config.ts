import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// repo: the hashed fingerprint of the repository the command runs in (sent as x-codeceipt-repo; never a URL or commit).
export type CliConfig = { apiUrl: string; projectId: string; token: string; repo?: string };

// The OS config dir, never the repo: $XDG_CONFIG_HOME or ~/.config on Linux, ~/Library/Application Support on
// macOS, %APPDATA% on Windows.
export function configPath(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  homedir: string,
): string {
  const base =
    platform === "win32"
      ? (env.APPDATA ?? join(homedir, "AppData", "Roaming"))
      : platform === "darwin"
        ? join(homedir, "Library", "Application Support")
        : (xdgConfigHome(env) ?? join(homedir, ".config"));
  return join(base, "codeceipt", "config.json");
}

/** Where the login was saved before the rename (D-019); read when the new place has none, never written. */
export function legacyConfigPath(configFile: string): string {
  return join(configFile, "..", "..", "projectbrain", "config.json");
}

// The XDG spec: a relative (or empty) XDG_CONFIG_HOME is invalid and ignored, so the token never lands in the cwd.
function xdgConfigHome(env: Record<string, string | undefined>): string | undefined {
  const dir = env.XDG_CONFIG_HOME;
  return dir && isAbsolute(dir) ? dir : undefined;
}

// The user config file: an optional default login at the top level (from `codeceipt login` outside a git repo, and
// every login before per-repo links existed) and one token per project in `projects` (D-020: one project per repo).
type ConfigFile = Partial<CliConfig> & { projects?: unknown };
const MAX_PROJECT_TOKENS = 200;

function readFile(path: string): ConfigFile | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? (raw as ConfigFile)
      : null;
  } catch {
    return null;
  }
}

function asConfig(raw: unknown): CliConfig | null {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<CliConfig>;
  if (
    typeof r.apiUrl !== "string" ||
    typeof r.projectId !== "string" ||
    typeof r.token !== "string"
  ) {
    return null;
  }
  return { apiUrl: r.apiUrl, projectId: r.projectId, token: r.token };
}

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/** The default login (top level of the file); used only outside a git repo. */
export function readConfig(path: string): CliConfig | null {
  const file = readFile(path);
  return file ? asConfig(file) : null;
}

function projectTokens(file: ConfigFile | null): CliConfig[] {
  const list = Array.isArray(file?.projects) ? file.projects : [];
  return list.flatMap((p) => asConfig(p) ?? []).slice(0, MAX_PROJECT_TOKENS);
}

/**
 * The token for a repo's linked project: same server (origin) and same project id, so a token is only ever sent to
 * the server that issued it, for the project it belongs to.
 */
export function readProjectToken(
  path: string,
  link: { apiUrl: string; projectId: string },
): CliConfig | null {
  const origin = originOf(link.apiUrl);
  if (!origin) return null;
  const file = readFile(path);
  const top = file ? asConfig(file) : null;
  return (
    [...projectTokens(file), ...(top ? [top] : [])].find(
      (c) => c.projectId === link.projectId && originOf(c.apiUrl) === origin,
    ) ?? null
  );
}

// Owner-only: the folder 0700 and the file 0600 (also when the file already existed with wider permissions).
function write(path: string, file: ConfigFile): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Saves the default login (top level), keeping the per-project tokens. */
export function writeConfig(path: string, config: CliConfig): void {
  const projects = projectTokens(readFile(path));
  write(path, { ...config, ...(projects.length > 0 ? { projects } : {}) });
}

/** Saves (or replaces) the token of one project, keeping the default login and the other projects' tokens. */
export function saveProjectToken(path: string, config: CliConfig): void {
  const file = readFile(path);
  const top = file ? asConfig(file) : null;
  const origin = originOf(config.apiUrl);
  const others = projectTokens(file).filter(
    (c) => !(c.projectId === config.projectId && originOf(c.apiUrl) === origin),
  );
  write(path, { ...(top ?? {}), projects: [...others, config].slice(-MAX_PROJECT_TOKENS) });
}
