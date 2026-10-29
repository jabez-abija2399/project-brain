// Bundles the CLI (with @brain/core and @brain/sandbox) into one runnable file, dist/projectbrain.mjs. The packages
// loaded at runtime (typescript, ignore, libpg-query, @electric-sql/pglite) stay external and are dependencies of this
// package. The sandbox child script is copied next to the bundle, where the bundled runner forks it (FEAT-015).
import { chmod, copyFile } from "node:fs/promises";
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
    external: ["typescript", "ignore", "libpg-query", "@electric-sql/pglite"],
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
  await copyFile(join(pkgDir, "../sandbox/src/child.mjs"), join(outDir, "child.mjs"));
  return outfile;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await build();
