import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexRepo } from "./index";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
  "tests/fixtures/next-app",
);

const bigFilePath = join(fixtureRoot, "big.ts");
const binaryFilePath = join(fixtureRoot, "src", "binary.ts");

beforeAll(() => {
  mkdirSync(join(fixtureRoot, "src"), { recursive: true });
  writeFileSync(bigFilePath, "// pad\n".repeat(200_000));
  const bin = Buffer.alloc(16);
  bin[0] = 0x00;
  bin[1] = 0x01;
  bin[2] = 0x00;
  writeFileSync(binaryFilePath, bin);
});

afterAll(() => {
  for (const p of [bigFilePath, binaryFilePath]) {
    try {
      rmSync(p);
    } catch {
      /* ignore */
    }
  }
});

describe("indexRepo on the next-app fixture", () => {
  it("AC-004-01 returns every React component with name, props and file path", async () => {
    const result = await indexRepo(fixtureRoot);
    const byName = new Map(result.components.map((c) => [c.name, c]));
    expect(byName.has("Button")).toBe(true);
    expect(byName.has("Card")).toBe(true);
    expect(byName.has("HomePage")).toBe(true);
    expect(byName.has("ReviewPage")).toBe(true);
    expect(byName.has("AboutPage")).toBe(true);
    expect(byName.has("RootLayout")).toBe(true);
    const button = byName.get("Button");
    expect(button?.path).toBe("src/components/Button.tsx");
    expect(button?.props).toContain("label");
    expect(button?.props).toContain("onClick");
    expect(button?.line).toBeGreaterThan(0);
    const card = byName.get("Card");
    expect(card?.path).toBe("src/components/Card.tsx");
    expect(card?.props).toContain("title");
    expect(card?.props).toContain("children");
  });

  it("AC-004-02 returns Next.js app-router routes mapped to URL paths", async () => {
    const result = await indexRepo(fixtureRoot);
    const byPath = new Map(result.routes.map((r) => [r.path, r]));
    expect(byPath.get("/")?.file).toBe("src/app/page.tsx");
    expect(byPath.get("/reviews/[id]")?.file).toBe("src/app/reviews/[id]/page.tsx");
    expect(byPath.get("/api/health")?.file).toBe("src/app/api/health/route.ts");
    expect(byPath.get("/about")?.file).toBe("src/app/(marketing)/about/page.tsx");
    expect(byPath.get("/api/health")?.method).toBe("route");
    expect(byPath.get("/")?.method).toBe("page");
  });

  it("AC-004-03 resolves relative and @/ alias imports to repo paths", async () => {
    const result = await indexRepo(fixtureRoot);
    const home = result.files.find((f) => f.path === "src/app/page.tsx");
    expect(home).toBeDefined();
    const aliasImport = home?.imports.find((i) => i.to === "@/components/Button");
    expect(aliasImport?.resolved).toBe("src/components/Button.tsx");
    expect(aliasImport?.external).toBe(true);
    const relImport = home?.imports.find((i) => i.to === "../components/Card");
    expect(relImport?.resolved).toBe("src/components/Card.tsx");
    expect(relImport?.external).toBe(false);
    const card = result.files.find((f) => f.path === "src/components/Card.tsx");
    const utils = card?.imports.find((i) => i.to === "@/lib/utils");
    expect(utils?.resolved).toBe("src/lib/utils.ts");
    const external = home?.imports.find((i) => i.to === "react");
    if (external) expect(external.resolved).toBeNull();
  });

  it("AC-004-04 reports syntax errors without stopping the rest of the index", async () => {
    const result = await indexRepo(fixtureRoot);
    const brokenErrs = result.errors.filter((e) => e.path === "src/broken.tsx");
    expect(brokenErrs.length).toBeGreaterThan(0);
    expect(brokenErrs[0]?.line).toBeGreaterThan(0);
    const okFile = result.files.find((f) => f.path === "src/components/Button.tsx");
    expect(okFile).toBeDefined();
    expect(result.components.some((c) => c.name === "Button")).toBe(true);
  });

  it("AC-004-05 skips oversized, binary, node_modules, .next, and gitignored files", async () => {
    const result = await indexRepo(fixtureRoot);
    const indexedPaths = new Set(result.files.map((f) => f.path));
    expect(indexedPaths.has("node_modules/evil/index.js")).toBe(false);
    expect([...indexedPaths].some((p) => p.startsWith(".next/"))).toBe(false);
    const bySkipped = new Map(result.skipped.map((s) => [s.path, s.reason]));
    expect(bySkipped.get("big.ts")).toBe("too_large");
    expect(bySkipped.get("src/binary.ts")).toBe("binary");
    expect(
      result.skipped.some((s) => s.reason === "excluded_dir" && s.path === "node_modules"),
    ).toBe(true);
    expect(result.skipped.some((s) => s.reason === "excluded_dir" && s.path === ".next")).toBe(
      true,
    );
  });

  it("AC-004-07 output contains no source code: only paths, hashes, symbols and signatures", async () => {
    const sentinel = "SENTINEL_LEAK_777_SHOULD_NOT_APPEAR";
    const leakPath = join(fixtureRoot, "src", "lib", "secrets.ts");
    writeFileSync(leakPath, `export const api = "${sentinel}";\n`);
    try {
      const result = await indexRepo(fixtureRoot);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(sentinel);
      const file = result.files.find((f) => f.path === "src/lib/secrets.ts");
      expect(file).toBeDefined();
      expect(file?.hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(leakPath);
    }
  });
});
