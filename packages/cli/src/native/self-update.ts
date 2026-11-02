import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, closeSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  LATEST_MANIFEST_URL,
  type ReleaseManifest,
  type Target,
  isNewer,
  releaseBase,
  verifyManifest,
} from "./release";

// D-027: the native binary updates itself. Only a manifest signed with the release key built into this binary is
// believed; only a newer version is installed; the download must be https end to end and match the signed SHA-256
// and size; the new file must run and report the promised version; then it replaces the installed file atomically
// (on Windows the running file is moved aside first). Any failure leaves the installed binary as it was.

export const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_MANIFEST_BYTES = 256 * 1024;

export type UpdateDeps = {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  execPath: string;
  target: Target;
  version: string;
  publicKey: string;
  platform: NodeJS.Platform;
  // Runs the downloaded file with `--version` and returns what it printed (or null). Injectable for tests.
  probe?: (file: string) => Promise<string | null>;
};

export type UpdateResult =
  | { status: "updated"; version: string; message: string }
  | { status: "up-to-date" | "disabled" | "failed"; message: string };

const https = (res: Response, requested: string) => {
  const final = res.url || requested;
  return final.startsWith("https://");
};

async function readText(res: Response, max: number): Promise<string | null> {
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > max ? null : buf.toString("utf8");
}

const defaultProbe = (file: string) =>
  new Promise<string | null>((resolve) => {
    execFile(
      file,
      ["--version"],
      // An empty environment (cast: apps that compile the CLI may require keys such as NODE_ENV in ProcessEnv).
      { timeout: 20_000, env: {} as NodeJS.ProcessEnv, windowsHide: true },
      (err, stdout) => resolve(err ? null : String(stdout).trim()),
    );
  });

export async function runUpdate(deps: UpdateDeps): Promise<UpdateResult> {
  if (!deps.publicKey) {
    return {
      status: "disabled",
      message:
        "This build has no release key, so it cannot verify updates. Install the latest version with the installer.",
    };
  }
  let manifest: ReleaseManifest | null = null;
  try {
    const [mRes, sRes] = await Promise.all([
      deps.fetch(LATEST_MANIFEST_URL, { redirect: "follow" }),
      deps.fetch(`${LATEST_MANIFEST_URL}.sig`, { redirect: "follow" }),
    ]);
    if (
      !mRes.ok ||
      !sRes.ok ||
      !https(mRes, LATEST_MANIFEST_URL) ||
      !https(sRes, LATEST_MANIFEST_URL)
    ) {
      return { status: "failed", message: "Could not fetch the release manifest over https." };
    }
    const [text, sig] = await Promise.all([
      readText(mRes, MAX_MANIFEST_BYTES),
      readText(sRes, 4096),
    ]);
    if (text !== null && sig !== null) manifest = verifyManifest(text, sig, deps.publicKey);
  } catch {
    return { status: "failed", message: "Could not reach GitHub to check for updates." };
  }
  if (!manifest)
    return {
      status: "failed",
      message: "The release manifest's signature did not verify; nothing was installed.",
    };
  if (!isNewer(manifest.version, deps.version)) {
    return { status: "up-to-date", message: `Codeceipt ${deps.version} is the latest version.` };
  }
  const entry = manifest.files[deps.target];
  if (!entry)
    return {
      status: "failed",
      message: `Release ${manifest.version} has no build for ${deps.target}.`,
    };

  const url = releaseBase(manifest.version) + entry.file;
  const dir = dirname(deps.execPath);
  const exe = deps.platform === "win32" ? ".exe" : "";
  const temp = join(dir, `.${basename(deps.execPath)}-${randomBytes(6).toString("hex")}.new${exe}`);
  let fd: number | null = null;
  try {
    const res = await deps.fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body || !https(res, url)) throw new Error("download not over https");
    // O_EXCL: never write through a file or link someone placed there.
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o755);
    const hash = createHash("sha256");
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > entry.size) throw new Error("larger than the signed size");
      hash.update(value);
      writeSync(fd, value);
    }
    closeSync(fd);
    fd = null;
    if (size !== entry.size || hash.digest("hex") !== entry.sha256)
      throw new Error("checksum mismatch");
    const reported = await (deps.probe ?? defaultProbe)(temp);
    if (reported !== `codeceipt ${manifest.version}`)
      throw new Error("the new file does not run as the promised version");
    replaceBinary(temp, deps.execPath, deps.platform);
  } catch (err) {
    if (fd !== null) closeSync(fd);
    rmSync(temp, { force: true });
    return {
      status: "failed",
      message: `Update to ${manifest.version} failed (${err instanceof Error ? err.message : "error"}); the installed version is unchanged.`,
    };
  }
  return {
    status: "updated",
    version: manifest.version,
    message: `Updated Codeceipt ${deps.version} -> ${manifest.version}.`,
  };
}

// POSIX: one atomic rename over the installed path (a running copy keeps its old file). Windows cannot replace a
// running .exe: it is renamed aside to <name>.old (removed on a later run) and the new file takes its place; if that
// second step fails the old file is put back.
function replaceBinary(temp: string, target: string, platform: NodeJS.Platform): void {
  if (platform !== "win32") {
    renameSync(temp, target);
    return;
  }
  const old = `${target}.old`;
  rmSync(old, { force: true });
  renameSync(target, old);
  try {
    renameSync(temp, target);
  } catch (err) {
    renameSync(old, target);
    throw err;
  }
}

export type UpdateState = { lastCheck?: string };
export type UpdateSettings = { autoUpdate?: boolean };

/** At most once a day, never when auto-update is off. A last check in the future (clock set back) does not count. */
export function shouldCheck(state: UpdateState, settings: UpdateSettings, now: Date): boolean {
  if (settings.autoUpdate === false) return false;
  const last = state.lastCheck ? Date.parse(state.lastCheck) : Number.NaN;
  if (!Number.isFinite(last) || last > now.getTime()) return true;
  return now.getTime() - last >= DAY_MS;
}
