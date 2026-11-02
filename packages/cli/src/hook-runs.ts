// D-028: every hook run is recorded on this computer (next to the user config), per agent and repo, so
// `codeceipt doctor` can tell when an agent's last session ran no Codeceipt hooks (a desktop app or cloud session that
// does not run plugin hooks). The repo is a hash of its folder: the record holds no path, token or session content.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type HookRun = { event: string; at: string; plugin: boolean };
type Runs = { version: 1; runs: Record<string, Record<string, HookRun>> };

const MAX_REPOS = 200;
const EVENTS = new Set(["session-start", "prompt", "stop", "session-end"]);
const AGENT = /^[a-z]{1,20}$/;

export const hookRunsFile = (configFile: string) => join(dirname(configFile), "hook-runs.json");
const repoKey = (root: string) => createHash("sha256").update(root).digest("hex").slice(0, 24);

function read(file: string): Runs {
  try {
    if (!existsSync(file) || !lstatSync(file).isFile()) return { version: 1, runs: {} };
    const doc = JSON.parse(readFileSync(file, "utf8")) as Runs;
    return doc && doc.version === 1 && typeof doc.runs === "object" && doc.runs !== null
      ? doc
      : { version: 1, runs: {} };
  } catch {
    return { version: 1, runs: {} };
  }
}

/** Records one hook run; never throws (a hook must not fail because the record could not be written). */
export function recordHookRun(
  file: string,
  agent: string,
  event: string,
  root: string,
  plugin: boolean,
  now = new Date(),
): void {
  if (!AGENT.test(agent) || !EVENTS.has(event)) return;
  try {
    const doc = read(file);
    const forAgent = { ...(doc.runs[agent] ?? {}) };
    delete forAgent[repoKey(root)];
    forAgent[repoKey(root)] = { event, at: now.toISOString(), plugin };
    // The newest repos are kept (insertion order), so the file stays small.
    const keys = Object.keys(forAgent);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REPOS))) delete forAgent[k];
    doc.runs[agent] = forAgent;
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) return;
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(doc)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  } catch {}
}

/** The last recorded hook run of an agent in a repo, or null. */
export function lastHookRun(file: string, agent: string, root: string): HookRun | null {
  const run = read(file).runs[agent]?.[repoKey(root)];
  return run && typeof run.at === "string" && !Number.isNaN(Date.parse(run.at)) ? run : null;
}
