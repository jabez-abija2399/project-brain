// Bundles the CLI (with @brain/core and @brain/sandbox) into one runnable file, dist/codeceipt.mjs. The packages
// loaded at runtime (typescript, ignore, libpg-query, @electric-sql/pglite) stay external and are dependencies of this
// package. The sandbox child script is copied next to the bundle, where the bundled runner forks it (FEAT-015).
import { chmod, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const pkgDir = fileURLToPath(new URL(".", import.meta.url));

export async function build({ outDir = join(pkgDir, "dist") } = {}) {
  const outfile = join(outDir, "codeceipt.mjs");
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
  await writeFile(
    join(outDir, "package.json"),
    `${JSON.stringify(await publishManifest(), null, 2)}\n`,
  );
  return outfile;
}

// dist/ is what gets published (npm publish packages/cli/dist): the public package is "codeceipt" (D-019), while the
// workspace package keeps its internal name @brain/cli. "projectbrain" stays as a second command name so hooks and
// helper commands set up before the rename keep working.
async function publishManifest() {
  const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8"));
  const external = ["typescript", "ignore", "libpg-query", "@electric-sql/pglite"];
  return {
    name: "codeceipt",
    version: pkg.version,
    description: "A receipt for every AI change.",
    type: "module",
    bin: { codeceipt: "./codeceipt.mjs", projectbrain: "./codeceipt.mjs" },
    files: ["codeceipt.mjs", "child.mjs"],
    engines: { node: ">=20" },
    dependencies: Object.fromEntries(external.map((name) => [name, pkg.dependencies[name]])),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await build();
