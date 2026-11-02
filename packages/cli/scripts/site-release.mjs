// D-027: prints the pinned release for the website installers (apps/web/src/lib/cli-release.json) from
// dist-native/manifest.json: the version and each target's SHA-256. The installers download only this version and
// accept only these checksums, so a release becomes installable from the site only through a reviewed PR.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const m = JSON.parse(readFileSync(join(pkgDir, "dist-native", "manifest.json"), "utf8"));
const sha256 = Object.fromEntries(Object.entries(m.files).map(([t, f]) => [t, f.sha256]));
console.log(JSON.stringify({ version: m.version, sha256 }, null, 2));
