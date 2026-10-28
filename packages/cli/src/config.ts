import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CliConfig = { apiUrl: string; projectId: string; token: string };

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
        : (env.XDG_CONFIG_HOME ?? join(homedir, ".config"));
  return join(base, "projectbrain", "config.json");
}

export function readConfig(path: string): CliConfig | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<CliConfig>;
    if (
      typeof raw.apiUrl !== "string" ||
      typeof raw.projectId !== "string" ||
      typeof raw.token !== "string"
    ) {
      return null;
    }
    return { apiUrl: raw.apiUrl, projectId: raw.projectId, token: raw.token };
  } catch {
    return null;
  }
}

// Owner-only: the folder 0700 and the file 0600 (also when the file already existed with wider permissions).
export function writeConfig(path: string, config: CliConfig): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
