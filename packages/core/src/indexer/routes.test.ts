import { describe, expect, it } from "vitest";
import { detectRoute } from "./routes";

// Backlog (FEAT-004 review L2): which files are App Router pages and routes.
describe("detectRoute (backlog)", () => {
  it("BL-13 page.js and page.ts are pages too, in every place an App Router folder lives", () => {
    for (const [file, path] of [
      ["app/page.js", "/"],
      ["app/about/page.ts", "/about"],
      ["src/app/shop/[id]/page.jsx", "/shop/[id]"],
      ["apps/web/src/app/api/health/route.ts", "/api/health"],
      ["packages/site/app/blog/page.tsx", "/blog"],
      // Security review: projects in any subfolder keep their routes.
      ["web/app/pricing/page.tsx", "/pricing"],
      ["frontend/src/app/api/x/route.ts", "/api/x"],
    ] as const) {
      expect(detectRoute(file)?.path, file).toBe(path);
    }
  });

  it("BL-14 a folder named app/ elsewhere is not the router", () => {
    for (const file of [
      "src/components/app/page.tsx",
      "lib/app/route.ts",
      "apps/web/src/features/app/page.tsx",
      "src/app/page.css",
      "src/app/route.tsx",
    ]) {
      expect(detectRoute(file), file).toBeNull();
    }
  });
});

describe("walk limits (backlog)", () => {
  it("BL-25 the walk stops at its file limit and counts skipped paths past the listing limit", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { walkRepo } = await import("./walker");
    const root = mkdtempSync(join(tmpdir(), "cc-walk-"));
    for (let i = 0; i < 30; i++) writeFileSync(join(root, `f${i}.ts`), "export {};\n");
    for (let i = 0; i < 12; i++) writeFileSync(join(root, `n${i}.png`), "x");
    const r = walkRepo(root, undefined, { files: 10, skipped: 5 });
    expect(r.files).toHaveLength(10);
    expect(r.skipped.length).toBeLessThanOrEqual(5);
    expect(r.errors.map((e) => e.message)).toContain("walk stopped at 10 files");
    const all = walkRepo(root, undefined, { skipped: 5 });
    expect(all.files).toHaveLength(30);
    expect(all.errors.map((e) => e.message)).toContain("7 more skipped paths not listed");
  });
});
