import { constants, accessSync, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { CliError, request } from "../api";
import type { CliConfig } from "../config";
import { readSettings } from "../config";
import { END_HOOK, START_HOOK, hookCommandPath, isOurHook } from "../templates";
import { INSTALL_PS1, INSTALL_SH, installKind } from "./install-info";

// D-027: `codeceipt doctor` checks the install, duplicate installs, login, repo link, hooks per agent, the last receipt
// and the server, in plain words; every problem comes with the exact command that fixes it. It only reads (and makes
// two GET requests); it changes nothing.

export type DoctorDeps = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  env: Record<string, string | undefined>;
  cwd: string;
  home: string;
  platform: NodeJS.Platform;
  execPath: string;
  scriptPath?: string;
  version: string;
  configFile: string;
  defaultApiUrl: string;
  stdout: (line: string) => void;
  // The repo's project (index.ts projectConfig), passed in to keep this module free of a circular import.
  repoProject: () => Promise<CliConfig>;
  inGitRepo: () => Promise<boolean>;
  hasLogin: () => boolean;
};

type Line = { ok: boolean | null; text: string; fix?: string[] };

const AGENTS = [
  {
    name: "Claude Code",
    dir: ".claude",
    file: ".claude/settings.json",
    flag: "--claude",
    agent: "claude",
  },
  { name: "Cursor", dir: ".cursor", file: ".cursor/hooks.json", flag: "--cursor", agent: "cursor" },
  { name: "Codex", dir: ".codex", file: ".codex/hooks.json", flag: "--codex", agent: "codex" },
  {
    name: "Antigravity",
    dir: ".agents",
    file: ".agents/hooks.json",
    flag: "--antigravity",
    agent: "antigravity",
  },
] as const;

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
const executable = (p: string) => {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Every codeceipt on PATH, in PATH order (npx's temporary folders are not installs). */
export function codeceiptsOnPath(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string[] {
  const names =
    platform === "win32" ? ["codeceipt.exe", "codeceipt.cmd", "codeceipt"] : ["codeceipt"];
  const dirs = (env.PATH ?? env.Path ?? "")
    .split(platform === "win32" ? ";" : delimiter)
    .filter(Boolean);
  const found: string[] = [];
  for (const dir of dirs) {
    if (/[\\/]_npx[\\/]/.test(dir)) continue;
    for (const n of names) {
      const p = join(dir, n);
      if (existsSync(p) && !found.includes(p)) found.push(p);
    }
  }
  return found;
}
const isNpmCopy = (p: string) =>
  /[\\/]node_modules[\\/]codeceipt[\\/]/.test(real(p).replace(/\\/g, "/") + "/") ||
  /[\\/]node_modules[\\/]codeceipt[\\/]/.test(real(p));

// Every command string in an agent's hooks file, whatever its layout (lists of hooks, or groups of hooks).
function hookCommands(file: string): string[] | null {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "command" && typeof x === "string") out.push(x);
      else walk(x, depth + 1);
    }
  };
  walk(doc, 0);
  return out;
}

export async function runDoctor(deps: DoctorDeps): Promise<number> {
  const lines: Line[] = [];
  const kind = installKind(deps.scriptPath);
  const current = kind === "native" ? deps.execPath : (deps.scriptPath ?? deps.execPath);

  // 1. The install.
  if (kind === "native") {
    lines.push({ ok: true, text: `Installed: native app ${deps.version} at ${deps.execPath}` });
    const on = readSettings(deps.configFile).autoUpdate !== false;
    lines.push({
      ok: true,
      text: on
        ? "Automatic updates: on (a signed new release is checked for at most once a day)"
        : "Automatic updates: off (run `codeceipt update` by hand, or `codeceipt config auto-update on`)",
    });
  } else {
    lines.push({
      ok: true,
      text: `Installed: ${kind === "npm" ? "npm package" : kind === "npx" ? "through npx" : "from source"} ${deps.version}${deps.scriptPath ? ` at ${deps.scriptPath}` : ""}`,
    });
    lines.push({
      ok: null,
      text: "Tip: the native app needs no Node.js, starts faster in hooks and updates itself.",
      fix: [`macOS, Linux, WSL: ${INSTALL_SH}`, `Windows PowerShell: ${INSTALL_PS1}`],
    });
  }

  // 2. Duplicate installs: the first codeceipt on PATH is the one agents and terminals run.
  const onPath = codeceiptsOnPath(deps.env, deps.platform);
  const first = onPath[0];
  if (!first) {
    lines.push({
      ok: false,
      text: "No codeceipt on PATH: terminals and agents cannot find the command",
      fix: [
        kind === "native"
          ? `Add ${join(deps.execPath, "..")} to PATH (the installer does this), then open a new terminal`
          : INSTALL_SH,
      ],
    });
  } else if (real(first) !== real(current)) {
    lines.push({
      ok: false,
      text: `Another codeceipt runs first: ${first} (${isNpmCopy(first) ? "npm" : "another install"})`,
      fix: [
        isNpmCopy(first)
          ? "npm uninstall -g codeceipt"
          : `Remove ${first}, or put ${join(current, "..")} earlier in PATH`,
      ],
    });
  } else {
    const others = onPath.slice(1).filter((p) => real(p) !== real(current));
    lines.push(
      others.length === 0
        ? { ok: true, text: `The codeceipt on PATH is this one (${first})` }
        : {
            ok: false,
            text: `Other copies are also installed: ${others.join(", ")}`,
            fix: [
              others.some(isNpmCopy) ? "npm uninstall -g codeceipt" : `Remove ${others.join(", ")}`,
            ],
          },
    );
  }

  // 3. Login and 4. the repo link.
  lines.push(
    deps.hasLogin()
      ? { ok: true, text: "Logged in" }
      : { ok: false, text: "Not logged in on this computer", fix: ["codeceipt"] },
  );
  let config: CliConfig | null = null;
  const inRepo = await deps.inGitRepo();
  if (!inRepo) {
    lines.push({
      ok: null,
      text: "Not in a git repository: run doctor in your app's folder to check its link and hooks",
    });
  } else {
    try {
      config = await deps.repoProject();
      lines.push({ ok: true, text: `This repo is linked to project ${config.projectId}` });
    } catch (err) {
      const msg = err instanceof CliError ? err.message : "";
      lines.push(
        /not the one connected/i.test(msg)
          ? {
              ok: false,
              text: "This repo carries another repository's link",
              fix: ["codeceipt unlink", "codeceipt"],
            }
          : /no token/i.test(msg)
            ? {
                ok: false,
                text: "This repo is linked, but this computer has no token for its project",
                fix: ["codeceipt"],
              }
            : {
                ok: false,
                text: "This repo is not linked to a Codeceipt project",
                fix: ["codeceipt"],
              },
      );
    }

    // 5. Hooks, per agent found in the repo.
    for (const a of AGENTS) {
      if (!existsSync(join(deps.cwd, a.dir))) continue;
      const commands = hookCommands(join(deps.cwd, a.file)) ?? [];
      const ours = commands.filter(
        (c) => isOurHook(c, START_HOOK(a.agent)) || isOurHook(c, END_HOOK(a.agent)),
      );
      if (ours.length === 0) {
        lines.push({
          ok: false,
          text: `${a.name} hooks are not set up in this repo`,
          fix: [`codeceipt init ${a.flag}`],
        });
        continue;
      }
      const paths = [...new Set(ours.map(hookCommandPath).filter((p): p is string => p !== null))];
      const missing = paths
        .map((p) => p.replace(/^\$HOME/, deps.home))
        .filter((p) => !executable(p));
      if (missing.length > 0) {
        lines.push({
          ok: false,
          text: `${a.name} hooks call ${missing.join(", ")}, which is not there`,
          fix: [`codeceipt init ${a.flag}`],
        });
      } else if (paths.length === 0 && !first) {
        lines.push({
          ok: false,
          text: `${a.name} hooks look for codeceipt on PATH and fall back to npx (slower, needs Node.js)`,
          fix: [`codeceipt init ${a.flag}`],
        });
      } else {
        lines.push({ ok: true, text: `${a.name} hooks are set up and find codeceipt` });
      }
    }
  }

  // 6. The last receipt and 7. the server.
  const apiUrl = (config?.apiUrl ?? deps.defaultApiUrl).replace(/\/+$/, "");
  if (config) {
    try {
      const last = await request<{ created_at?: unknown }>(
        deps.fetch,
        config,
        "GET",
        `/api/hooks/${encodeURIComponent(config.projectId)}/last-receipt`,
      );
      const at =
        typeof last.created_at === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(last.created_at)
          ? `${last.created_at.slice(0, 16).replace("T", " ")} UTC`
          : null;
      lines.push(
        at
          ? { ok: true, text: `Last receipt: ${at}` }
          : { ok: null, text: "No receipt yet: ask your agent for a change and end the session" },
      );
    } catch {
      lines.push({ ok: false, text: "Could not read the last receipt", fix: ["codeceipt last"] });
    }
  }
  try {
    const res = await deps.fetch(`${apiUrl}/api/health`);
    lines.push(
      res.ok
        ? { ok: true, text: `Server reachable: ${apiUrl}` }
        : {
            ok: false,
            text: `Server reachable but not ready (${res.status}): ${apiUrl}`,
            fix: ["Try again in a few minutes; if it stays, tell the Codeceipt team"],
          },
    );
  } catch {
    lines.push({
      ok: false,
      text: `Cannot reach ${apiUrl}`,
      fix: ["Check your internet connection, VPN or proxy: https to this address must be allowed"],
    });
  }

  for (const l of lines) {
    deps.stdout(`${l.ok === true ? "OK  " : l.ok === false ? "FIX " : "--  "} ${l.text}`);
    for (const f of l.fix ?? []) deps.stdout(`     ${l.ok === false ? "Fix: " : ""}${f}`);
  }
  const problems = lines.filter((l) => l.ok === false).length;
  deps.stdout("");
  deps.stdout(
    problems === 0
      ? "No problems found."
      : `${problems} problem${problems === 1 ? "" : "s"} found.`,
  );
  return problems === 0 ? 0 : 1;
}
