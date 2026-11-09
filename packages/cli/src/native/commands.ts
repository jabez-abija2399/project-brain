import { spawn } from "node:child_process";
import {
  constants,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { CliError, EXIT } from "../api";
import { gateMode, readSettings, writeSettings } from "../config";
import { INSTALL_PS1, INSTALL_SH, installKind, nativeBuild } from "./install-info";
import { RELEASE_PUBLIC_KEY } from "./release-key";
import { type UpdateDeps, type UpdateState, runUpdate, shouldCheck } from "./self-update";

type Out = { stdout: (line: string) => void; stderr: (line: string) => void };

const CONFIG_USAGE =
  "Usage: codeceipt config auto-update [on|off] | codeceipt config stop-gate [on|gentle|off] | codeceipt config guard [strict|gentle|off]";
const GUARD_TEXT = {
  strict: "Codeceipt Guard is strict: a commit or CI run with problems fails until they are fixed.",
  gentle: "Codeceipt Guard is gentle: problems are reported, nothing is blocked.",
  off: "Codeceipt Guard is off: `codeceipt guard` checks nothing.",
} as const;
const GATE_VALUES = new Set(["on", "off", "gentle", "strict"]);

/** `codeceipt config auto-update [on|off]` and (FEAT-020) `codeceipt config stop-gate [on|off]`. */
export function configCommand(args: string[], configFile: string, out: Out): void {
  const [key, value, ...rest] = args;
  if (key === "guard") {
    if (rest.length > 0 || (value !== undefined && !(value in GUARD_TEXT))) {
      throw new CliError(EXIT.usage, CONFIG_USAGE);
    }
    if (value === undefined) {
      out.stdout(GUARD_TEXT[readSettings(configFile).guard ?? "strict"]);
      return;
    }
    const mode = value as keyof typeof GUARD_TEXT;
    writeSettings(configFile, { guard: mode });
    out.stdout(GUARD_TEXT[mode]);
    return;
  }
  if (
    (key !== "auto-update" && key !== "stop-gate") ||
    rest.length > 0 ||
    (value !== undefined && value !== "on" && value !== "off" && key === "auto-update") ||
    (value !== undefined && !GATE_VALUES.has(value) && key === "stop-gate")
  ) {
    throw new CliError(EXIT.usage, CONFIG_USAGE);
  }
  if (key === "stop-gate") {
    if (value === undefined) {
      const mode = gateMode(readSettings(configFile));
      out.stdout(`The stop gate is ${mode === "strict" ? "on" : mode}.`);
      return;
    }
    // Roadmap Phase 4a: "gentle" tells the agent what is missing without blocking it; "strict" is the same as "on".
    if (value === "gentle") {
      writeSettings(configFile, { stopGate: "gentle" });
      out.stdout(
        "The stop gate is gentle: when a receipt shows unfinished work, the agent is told what is missing (at most twice per session); Claude Code gets no blocking error.",
      );
      return;
    }
    writeSettings(configFile, { stopGate: value !== "off" });
    out.stdout(
      value !== "off"
        ? "The stop gate is on: when a receipt shows unfinished work, the agent is told to finish it before stopping (at most twice per session)."
        : "The stop gate is off: receipts are still made, but the agent is never held back.",
    );
    return;
  }
  if (value === undefined) {
    const on = readSettings(configFile).autoUpdate !== false;
    out.stdout(`Automatic updates are ${on ? "on" : "off"}.`);
    return;
  }
  writeSettings(configFile, { autoUpdate: value === "on" });
  out.stdout(
    value === "on"
      ? "Automatic updates are on: Codeceipt checks for a new signed release at most once a day."
      : "Automatic updates are off. Run `codeceipt update` to update by hand.",
  );
}

const statePath = (configFile: string) => join(configFile, "..", "update.json");
function readState(configFile: string): UpdateState {
  try {
    const raw = JSON.parse(readFileSync(statePath(configFile), "utf8")) as { lastCheck?: unknown };
    return typeof raw.lastCheck === "string" ? { lastCheck: raw.lastCheck } : {};
  } catch {
    return {};
  }
}
function writeState(configFile: string, state: UpdateState & { lastResult?: string }): void {
  try {
    mkdirSync(join(configFile, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(statePath(configFile), `${JSON.stringify(state)}\n`, { mode: 0o600 });
  } catch {}
}

// One update at a time: a lock file created exclusively; one older than 15 minutes is a crashed run and is removed.
function withLock<T>(configFile: string, fn: () => Promise<T>): Promise<T | null> {
  const lock = join(configFile, "..", "update.lock");
  try {
    if (Date.now() - statSync(lock).mtimeMs > 15 * 60_000) rmSync(lock, { force: true });
  } catch {}
  let fd: number;
  try {
    mkdirSync(join(configFile, ".."), { recursive: true, mode: 0o700 });
    fd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  } catch {
    return Promise.resolve(null);
  }
  closeSync(fd);
  return fn().finally(() => rmSync(lock, { force: true }));
}

/** `codeceipt update [--background]`: now, for the native binary; npm and npx copies point to the installer. */
export async function updateCommand(
  args: string[],
  configFile: string,
  out: Out,
  deps: Pick<UpdateDeps, "fetch"> & {
    platform: NodeJS.Platform;
    scriptPath?: string;
    execPath: string;
    version: string;
  },
): Promise<number> {
  const background = args.includes("--background");
  const build = nativeBuild();
  if (!build) {
    const kind = installKind(deps.scriptPath);
    out.stdout(
      kind === "npm"
        ? "This copy was installed with npm. Update it with `npm install -g codeceipt@latest`, or switch to the native app, which updates itself:"
        : "This copy runs through npx or from source and does not update itself. Install the native app, which updates itself and needs no Node.js:",
    );
    out.stdout(`  macOS, Linux, WSL:   ${INSTALL_SH}`);
    out.stdout(`  Windows PowerShell:  ${INSTALL_PS1}`);
    return EXIT.ok;
  }
  const result = await withLock(configFile, () =>
    runUpdate({
      fetch: deps.fetch,
      execPath: deps.execPath,
      target: build.target,
      version: deps.version,
      publicKey: RELEASE_PUBLIC_KEY,
      platform: deps.platform,
    }),
  );
  writeState(configFile, {
    lastCheck: new Date().toISOString(),
    ...(result ? { lastResult: result.status } : {}),
  });
  if (!result) {
    if (!background) out.stdout("Another update is already running.");
    return EXIT.ok;
  }
  if (!background) (result.status === "failed" ? out.stderr : out.stdout)(result.message);
  return result.status === "failed" && !background ? EXIT.server : EXIT.ok;
}

/**
 * Called by the native entry before each command: at most once a day (and never when auto-update is off) it starts
 * `codeceipt update --background` detached, so no command, and no hook, waits for the network.
 */
export function maybeStartBackgroundUpdate(
  configFile: string,
  execPath: string,
  command: string | undefined,
): void {
  if (!nativeBuild() || command === "update" || command === "__sandbox-child") return;
  const now = new Date();
  if (!shouldCheck(readState(configFile), readSettings(configFile), now)) return;
  // Recorded first, so a failing or slow check is not started again by every following command.
  writeState(configFile, { ...readState(configFile), lastCheck: now.toISOString() });
  try {
    const child = spawn(execPath, ["update", "--background"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
  } catch {}
}
