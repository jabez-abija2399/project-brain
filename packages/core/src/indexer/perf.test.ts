import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexRepo } from "./index";

const perfRoot = join(tmpdir(), `brain-indexer-perf-${process.pid}`);

beforeAll(() => {
  mkdirSync(join(perfRoot, "src", "generated"), { recursive: true });
  writeFileSync(
    join(perfRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
  );
  writeFileSync(join(perfRoot, ".gitignore"), "node_modules/\n.next/\n");
  for (let i = 0; i < 500; i += 1) {
    const name = `C${i.toString().padStart(4, "0")}`;
    const importFrom = `./C${((i + 1) % 500).toString().padStart(4, "0")}`;
    const body = `import { C${((i + 1) % 500).toString().padStart(4, "0")} as Next } from "${importFrom}";
export function ${name}({ label }: { label: string }) {
  return <div>{label}<Next label={label} /></div>;
}
`;
    writeFileSync(join(perfRoot, "src", "generated", `${name}.tsx`), body);
  }
});

afterAll(() => {
  try {
    rmSync(perfRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("indexRepo performance budget", () => {
  it("AC-004-06 indexes a 500-file fixture in under 20 s", async () => {
    const started = Date.now();
    const result = await indexRepo(perfRoot);
    const elapsedMs = Date.now() - started;
    expect(result.files.length).toBe(500);
    expect(result.components.length).toBeGreaterThanOrEqual(500);
    expect(elapsedMs).toBeLessThan(20_000);
  }, 30_000);
});
