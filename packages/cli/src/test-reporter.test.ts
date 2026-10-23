import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));

// Each workspace's own `test` script (what root `pnpm test` runs via `pnpm -r test`),
// filtered to one fast file that contains an AC-named test.
const cases = [
  { dir: "packages/agent-kit", file: "src/index.test.ts" },
  { dir: "packages/cli", file: "src/index.test.ts" },
  { dir: "packages/core", file: "src/index.test.ts" },
  { dir: "packages/db", file: "src/check.test.ts" },
  { dir: "apps/web", file: "src/app/api/health/route.happy.test.ts" },
];

describe("pnpm test reporter", () => {
  it.each(cases)(
    "AC-001-04 $dir prints every test name with its AC id",
    ({ dir, file }) => {
      const out = execFileSync("pnpm", ["run", "test", file], {
        cwd: `${root}${dir}`,
        encoding: "utf8",
        env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
      });
      expect(out).toMatch(/AC-\d{3}-\d{2} /);
    },
    60000,
  );
});
