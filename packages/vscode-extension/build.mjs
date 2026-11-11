// Bundles the extension into dist/extension.js (CommonJS, as VS Code loads it). `vscode` is provided by the editor.
// Packaging into a .vsix and publishing are the owner's steps (docs/vscode-extension.md).
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const pkgDir = fileURLToPath(new URL(".", import.meta.url));
await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  logLevel: "warning",
  absWorkingDir: pkgDir,
});
