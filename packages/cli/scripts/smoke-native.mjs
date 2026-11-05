// D-027: runs a built native binary for real (release workflow, on each platform that can run it; also locally):
// --version, help, and one SQL sandbox job through `__sandbox-child` (embedded PGlite, empty environment). Exits
// non-zero on any failure. Usage: node scripts/smoke-native.mjs dist-native/codeceipt-linux-x64
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const bin = process.argv[2];
if (!bin) throw new Error("usage: node scripts/smoke-native.mjs <binary>");
const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
const check = (ok, what) => {
  if (!ok) {
    console.error(`FAIL ${what}`);
    process.exit(1);
  }
  console.log(`ok   ${what}`);
};
// The binary must run on its embedded files only, as on a user's computer: the WebAssembly and data files of this
// checkout's node_modules are moved aside for the run (a compiled-in build-machine path would otherwise still work
// here; that is how the 0.3.2 binaries passed this check and then aborted elsewhere). Put back on exit.
const hidden = [];
const store = join(pkgDir, "..", "..", "node_modules", ".pnpm");
if (existsSync(store)) {
  for (const dir of readdirSync(store)) {
    if (!/^(libpg-query|@electric-sql\+pglite)@/.test(dir)) continue;
    for (const rel of readdirSync(join(store, dir), { recursive: true })) {
      if (!/\.(wasm|data)$/.test(String(rel))) continue;
      const file = join(store, dir, String(rel));
      renameSync(file, `${file}.smoke-hidden`);
      hidden.push(file);
    }
  }
}
process.on("exit", () => {
  for (const file of hidden) renameSync(`${file}.smoke-hidden`, file);
});
console.log(`(${hidden.length} WebAssembly/data files of node_modules hidden for this run)`);
const t0 = Date.now();
const v = execFileSync(bin, ["--version"], { encoding: "utf8" }).trim();
check(
  v === `codeceipt ${version}`,
  `--version prints "codeceipt ${version}" (${Date.now() - t0} ms)`,
);
check(
  execFileSync(bin, ["help"], { encoding: "utf8" }).includes("codeceipt doctor"),
  "help lists doctor",
);
const job = JSON.stringify({
  statements: [
    { sql: "create table public.notes (id uuid default gen_random_uuid())" },
    { sql: "alter table public.notes enable row level security" },
  ],
  cap: 5000,
});
const r = spawnSync(bin, ["__sandbox-child"], {
  input: job,
  env: {},
  encoding: "utf8",
  timeout: 120_000,
});
let result = null;
try {
  result = JSON.parse(r.stdout);
} catch {}
check(
  result?.type === "result" && result.outcome === "ok",
  "sandbox child runs a migration with embedded PGlite",
);
check(
  result?.tables?.some((t) => t.name === "notes" && t.rlsEnabled === true),
  "sandbox reads RLS back",
);
// On Windows, Node's process launcher (libuv) always adds these system variables to a child, even with env: {}:
// Windows programs need them. They hold no secrets; anything else (a token, SUPABASE_DB_URL) still fails the check.
const WINDOWS_SYSTEM_ENV = new Set([
  "HOMEDRIVE",
  "HOMEPATH",
  "LOGONSERVER",
  "PATH",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
]);
const extraEnv = Array.isArray(result?.childEnvKeys)
  ? result.childEnvKeys.filter(
      (k) => !(process.platform === "win32" && WINDOWS_SYSTEM_ENV.has(k.toUpperCase())),
    )
  : null;
if (extraEnv && extraEnv.length > 0) console.error(`unexpected variables: ${extraEnv.join(", ")}`);
check(
  extraEnv !== null && extraEnv.length === 0,
  process.platform === "win32"
    ? "sandbox child has only the Windows system variables"
    : "sandbox child has an empty environment",
);
