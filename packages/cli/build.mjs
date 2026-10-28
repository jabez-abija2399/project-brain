// Bundles the CLI (with @brain/core) into one runnable file, dist/projectbrain.mjs. The packages core loads at
// runtime (typescript, ignore, libpg-query) stay external and are dependencies of this package.
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const pkgDir = fileURLToPath(new URL(".", import.meta.url));

export async function build({ outDir = join(pkgDir, "dist") } = {}) {
  const outfile = join(outDir, "projectbrain.mjs");
  await esbuild.build({
    entryPoints: [join(pkgDir, "src/main.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["typescript", "ignore", "libpg-query"],
    banner: {
      js: [
        "#!/usr/bin/env node",
        // esbuild's ESM output has no require(); bundled CommonJS code needs one.
        'import { createRequire as __pbCreateRequire } from "node:module";',
        "const require = __pbCreateRequire(import.meta.url);",
      ].join("\n"),
    },
    logLevel: "warning",
    absWorkingDir: pkgDir,
  });
  await chmod(outfile, 0o755);
  return outfile;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await build();
