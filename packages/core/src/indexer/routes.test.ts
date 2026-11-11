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
