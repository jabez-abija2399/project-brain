import { statSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * D-028 (security review): the absolute path of a program to run without a shell, from absolute PATH folders only
 * (Windows also looks in the current folder for a bare name, which a cloned repo could fill). Windows: .exe or .com
 * only, since a .cmd needs a shell. Null when there is none.
 */
export function findProgram(
  name: string,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string | null {
  const exts = platform === "win32" ? [".exe", ".com"] : [""];
  const dirs = (env.PATH ?? env.Path ?? "")
    .split(platform === "win32" ? ";" : delimiter)
    .filter((dir) => (platform === "win32" ? /^[A-Za-z]:[\\/]/.test(dir) : dir.startsWith("/")));
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      try {
        if (statSync(p).isFile()) return p;
      } catch {}
    }
  }
  return null;
}
