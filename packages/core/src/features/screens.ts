import { ROOT_PAGES, cleanName } from "./placement";

// Apps with no router (Bolt): App switches screens itself. Folders and names that hold app chrome or plumbing, not a
// screen, when App imports them directly.
const NOT_SCREEN_DIRS = new Set([
  "contexts",
  "context",
  "providers",
  "hooks",
  "lib",
  "utils",
  "types",
  "styles",
  "store",
  "stores",
  "services",
  "api",
  "config",
  "constants",
  "ui",
  "layout",
  "layouts",
  "icons",
]);
const NOT_SCREEN_NAMES = new Set([
  "header",
  "footer",
  "navbar",
  "nav",
  "navigation",
  "sidebar",
  "layout",
  "provider",
  "providers",
  "error-boundary",
  "toaster",
  "loading",
  "spinner",
]);
export const APP_ROOT_FILE = /^src\/App\.[jt]sx?$/;

export function screenKey(path: string): string | null {
  const parts = path.split("/");
  const base = (parts.pop() ?? "").replace(/\.[jt]sx$/, "");
  if (!/\.[jt]sx$/.test(path)) return null;
  if (parts.some((p) => NOT_SCREEN_DIRS.has(p))) return null;
  const name = cleanName(base);
  return name && !NOT_SCREEN_NAMES.has(name) && !ROOT_PAGES.has(name) ? name : null;
}
