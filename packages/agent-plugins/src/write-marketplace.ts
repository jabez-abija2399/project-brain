// D-028: writes the marketplace folder from the generator (pnpm -C packages/agent-plugins generate). Files that are
// no longer generated are removed, so the folder is always exactly the generator's output (a test checks it).
import { chmodSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { generateMarketplace } from "./index.ts";

const root = fileURLToPath(new URL("../marketplace", import.meta.url));
const files = generateMarketplace();
const existing = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? existing(p) : [relative(root, p).replace(/\\/g, "/")];
  });
mkdirSync(root, { recursive: true });
for (const path of existing(root)) if (!files.has(path)) rmSync(join(root, path));
for (const [path, text] of files) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  if (path.endsWith(".sh")) chmodSync(target, 0o755);
}
console.log(`Wrote ${files.size} files to ${relative(process.cwd(), root) || "."}`);
