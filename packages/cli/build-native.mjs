// D-027: compiles the CLI into one self-contained executable per target with `bun build --compile`, then writes
// dist-native/manifest.json: the version and, per target, the file name, SHA-256 and size. The manifest is signed in the
// release workflow (scripts/sign-manifest.mjs), never here. Usage:
//   node build-native.mjs                      all 7 targets
//   node build-native.mjs linux-x64 darwin-arm64
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = fileURLToPath(new URL(".", import.meta.url));
const outDir = join(pkgDir, "dist-native");
// Release target -> Bun's compile target.
export const BUN_TARGETS = {
  "darwin-arm64": "bun-darwin-arm64",
  "darwin-x64": "bun-darwin-x64",
  "linux-x64": "bun-linux-x64",
  "linux-arm64": "bun-linux-arm64",
  "linux-x64-musl": "bun-linux-x64-musl",
  "linux-arm64-musl": "bun-linux-arm64-musl",
  "windows-x64": "bun-windows-x64",
};
const fileNameFor = (t) => `codeceipt-${t}${t.startsWith("windows") ? ".exe" : ""}`;

export function buildNative(targets = Object.keys(BUN_TARGETS)) {
  const version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const target of targets) {
    if (!BUN_TARGETS[target]) throw new Error(`unknown target ${target}`);
    const file = fileNameFor(target);
    const outfile = join(outDir, file);
    // No shell: every argument is passed as is. --define fixes the target this binary updates itself to.
    execFileSync(
      "bun",
      [
        "build",
        "--compile",
        "--minify",
        `--target=${BUN_TARGETS[target]}`,
        `--define=__CODECEIPT_TARGET__=${JSON.stringify(target)}`,
        join(pkgDir, "src/native-main.ts"),
        "--outfile",
        outfile,
      ],
      { cwd: pkgDir, stdio: ["ignore", "inherit", "inherit"] },
    );
  }
  return writeManifest(outDir, version, targets);
}

/**
 * dist-native/manifest.json and SHA256SUMS from the files as they are now. The release workflow runs it again after
 * macOS and Windows signing, which change the bytes: the manifest always describes the files that are published.
 */
export function writeManifest(dir, version, targets) {
  const files = {};
  for (const target of targets) {
    const file = fileNameFor(target);
    const bytes = readFileSync(join(dir, file));
    files[target] = {
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: statSync(join(dir, file)).size,
    };
  }
  const manifest = { name: "codeceipt", version, files };
  const outDir = dir;
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  // Plain checksums too, for people checking a download by hand (sha256sum -c SHA256SUMS).
  writeFileSync(
    join(outDir, "SHA256SUMS"),
    Object.values(files)
      .map((f) => `${f.sha256}  ${f.file}\n`)
      .join(""),
  );
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  // `--manifest-only`: rewrite the manifest for the binaries already in dist-native (after signing).
  const m =
    args[0] === "--manifest-only"
      ? writeManifest(
          outDir,
          JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version,
          Object.keys(BUN_TARGETS),
        )
      : buildNative(args.length > 0 ? args : undefined);
  for (const [t, f] of Object.entries(m.files)) console.log(`${t}\t${f.size}\t${f.sha256}`);
}
