import { execFile } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, sep } from "node:path";

// Roadmap Phase 11: how the extension reaches Codeceipt. It runs only the installed `codeceipt` command, found the way
// the agent plugins' launcher finds it (the native install folder, then absolute PATH folders), never one inside the
// opened folder: a cloned repo must not be able to make the editor run its own program. Arguments are fixed words,
// passed as a list (no shell). Only the CLI's JSON answer is read, with a size and a time limit.

export const ALLOWED = [
  ["status", "--json"],
  ["last", "--json"],
] as const;
export type Allowed = (typeof ALLOWED)[number];

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT = 256 * 1024;

type Probe = {
  /** A regular file is there. */
  exists: (path: string) => boolean;
  /** Anything is there (a file or a folder). */
  present: (path: string) => boolean;
  real: (path: string) => string;
};
const DISK: Probe = {
  exists: (p) => {
    try {
      return existsSync(p) && statSync(p).isFile();
    } catch {
      return false;
    }
  },
  present: (p) => existsSync(p),
  real: (p) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  },
};

// Windows and macOS folders ignore letter case, so the comparison does too (stricter, never looser).
const inside = (path: string, folder: string) => {
  const p = path.toLowerCase();
  const f = folder.toLowerCase();
  return p === f || p.startsWith(f.endsWith(sep) ? f : f + sep);
};

// A folder on PATH counts only when its full address is given: "/..." or, on Windows, "C:\..." (a driveless "\tools"
// would be read against whichever drive the opened folder is on).
const absolute = (folder: string, platform: NodeJS.Platform) =>
  platform === "win32" ? /^[A-Za-z]:[\\/]/.test(folder) : isAbsolute(folder);

/** The repository an opened folder belongs to: the nearest folder at or above it that has a `.git`, or null. */
export function repoRootOf(folder: string, probe: Probe = DISK): string | null {
  let dir = folder;
  for (let i = 0; i < 64; i++) {
    if (probe.present(join(dir, ".git"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** The folders nothing may be run from: every opened folder and the repository each one belongs to. */
function untrusted(workspaceFolders: string[], probe: Probe): string[] {
  const roots = new Set<string>();
  for (const w of workspaceFolders) {
    const real = probe.real(w);
    roots.add(real);
    const repo = repoRootOf(real, probe);
    if (repo) roots.add(repo);
  }
  return [...roots];
}

/**
 * The PATH the command itself gets: only full folder addresses outside the opened folders and their repositories,
 * so that nothing it starts (git, node) can come from the project either.
 */
export function safePath(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  workspaceFolders: string[],
  probe: Probe = DISK,
): string {
  const roots = untrusted(workspaceFolders, probe);
  const split = platform === "win32" ? ";" : delimiter;
  return (env.PATH ?? env.Path ?? "")
    .split(split)
    .filter((f) => f.length > 0 && absolute(f, platform))
    .filter((f) => !roots.some((r) => inside(f, r) || inside(probe.real(f), r)))
    .join(split);
}

/**
 * The installed codeceipt's full path, or null. Relative PATH entries (".", "./node_modules/.bin") are skipped, and
 * so is anything that lies, or whose real path lies, inside an opened folder or the repository it belongs to.
 */
export function findCodeceipt(
  env: Record<string, string | undefined>,
  home: string,
  platform: NodeJS.Platform,
  workspaceFolders: string[],
  probe: Probe = DISK,
): string | null {
  // Windows: only the native .exe (a .cmd or .bat would need a shell, which is never used).
  const names = platform === "win32" ? ["codeceipt.exe"] : ["codeceipt"];
  const folders = [
    join(home, ".local", "bin"),
    ...(env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : delimiter),
    ...(platform === "win32" ? [] : ["/usr/local/bin", "/opt/homebrew/bin"]),
  ].filter((f) => f.length > 0 && absolute(f, platform));
  const roots = untrusted(workspaceFolders, probe);
  for (const folder of folders) {
    for (const name of names) {
      const candidate = join(folder, name);
      if (!probe.exists(candidate)) continue;
      const real = probe.real(candidate);
      if (roots.some((r) => inside(real, r) || inside(candidate, r))) continue;
      return candidate;
    }
  }
  return null;
}

export type CliAnswer =
  | { ok: true; json: unknown }
  | { ok: false; reason: "failed" | "bad_output" };

/** Runs one allowed command in a folder and reads its JSON line. Never throws. */
export function runCodeceipt(
  bin: string,
  args: Allowed,
  cwd: string,
  path: string = process.env.PATH ?? "",
): Promise<CliAnswer> {
  return new Promise((resolve) => {
    // Only the fixed argument lists above are ever run.
    if (!ALLOWED.some((a) => a.length === args.length && a.every((w, i) => w === args[i]))) {
      resolve({ ok: false, reason: "failed" });
      return;
    }
    execFile(
      bin,
      [...args],
      {
        cwd,
        // The command's own PATH (see safePath): both spellings, since Windows uses "Path".
        env: { ...process.env, PATH: path, Path: path },
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
        shell: false,
      },
      (error, stdout) => {
        if (error) {
          resolve({ ok: false, reason: "failed" });
          return;
        }
        try {
          resolve({ ok: true, json: JSON.parse(String(stdout).trim()) });
        } catch {
          resolve({ ok: false, reason: "bad_output" });
        }
      },
    );
  });
}
