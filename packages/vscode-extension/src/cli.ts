import { execFile } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join, sep } from "node:path";

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
  exists: (path: string) => boolean;
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

/**
 * The installed codeceipt's absolute path, or null. Relative PATH entries (".", "./node_modules/.bin") are skipped,
 * and so is anything whose real path lies inside one of the opened folders.
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
    ...(env.PATH ?? env.Path ?? "").split(delimiter),
    ...(platform === "win32" ? [] : ["/usr/local/bin", "/opt/homebrew/bin"]),
  ].filter((f) => f.length > 0 && isAbsolute(f));
  const roots = workspaceFolders.map((w) => probe.real(w));
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
export function runCodeceipt(bin: string, args: Allowed, cwd: string): Promise<CliAnswer> {
  return new Promise((resolve) => {
    // Only the fixed argument lists above are ever run.
    if (!ALLOWED.some((a) => a.length === args.length && a.every((w, i) => w === args[i]))) {
      resolve({ ok: false, reason: "failed" });
      return;
    }
    execFile(
      bin,
      [...args],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true, shell: false },
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
