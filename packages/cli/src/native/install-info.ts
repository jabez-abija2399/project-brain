import type { Target } from "./release";

// D-027: whether this process is the native binary (and for which target). Set only by native-main.ts, the entry the
// binaries are compiled from; the npm build and the tests never set it.
export type NativeBuild = { target: Target };
let native: NativeBuild | null = null;
export function setNativeBuild(build: NativeBuild | null): void {
  native = build;
}
export function nativeBuild(): NativeBuild | null {
  return native;
}

export const SITE = "https://codeceipts.vercel.app";
export const INSTALL_SH = `curl -fsSL ${SITE}/install.sh | sh`;
export const INSTALL_PS1 = `irm ${SITE}/install.ps1 | iex`;

/** How this copy was installed: the native binary, a global npm install, a one-off npx run, or a source checkout. */
export function installKind(scriptPath: string | undefined): "native" | "npm" | "npx" | "source" {
  if (native) return "native";
  const p = (scriptPath ?? "").replace(/\\/g, "/");
  if (/\/_npx\//.test(p)) return "npx";
  if (/\/node_modules\/codeceipt\//.test(p)) return "npm";
  return "source";
}
