import { describe, expect, it } from "vitest";
import { detectFileRoutes } from "./file-routes";

const map = (paths: string[]) =>
  Object.fromEntries(detectFileRoutes(paths).map((r) => [r.file, r.path]));

describe("file-based routers (backlog)", () => {
  it("BL-32 Expo Router: screens under app/ with a root _layout, groups dropped, index is the folder", () => {
    expect(
      map([
        "app/_layout.tsx",
        "app/index.tsx",
        "app/(tabs)/_layout.tsx",
        "app/(tabs)/reviews.tsx",
        "app/reviews/[id].tsx",
        "app/+not-found.tsx",
        "app/api/hello+api.ts",
        "components/Card.tsx",
      ]),
    ).toEqual({
      "app/index.tsx": "/",
      "app/(tabs)/reviews.tsx": "/reviews",
      "app/reviews/[id].tsx": "/reviews/[id]",
    });
  });

  it("BL-33 TanStack Router: src/routes with __root, dots and folders nest, pathless and ignored files skipped", () => {
    expect(
      map([
        "src/routes/__root.tsx",
        "src/routes/index.tsx",
        "src/routes/reviews.tsx",
        "src/routes/reviews.$id.tsx",
        "src/routes/_auth.login.tsx",
        "src/routes/posts/index.tsx",
        "src/routes/-helpers.ts",
      ]),
    ).toEqual({
      "src/routes/index.tsx": "/",
      "src/routes/reviews.tsx": "/reviews",
      "src/routes/reviews.$id.tsx": "/reviews/$id",
      "src/routes/_auth.login.tsx": "/login",
      "src/routes/posts/index.tsx": "/posts",
    });
  });

  it("BL-34 React Router v7: app/routes next to app/root, $params become :params, _index is /", () => {
    expect(
      map([
        "app/root.tsx",
        "app/routes/_index.tsx",
        "app/routes/reviews.$id.tsx",
        "app/routes/_auth.login.tsx",
        "app/routes/settings/route.tsx",
        "app/routes/settings/form.tsx",
      ]),
    ).toEqual({
      "app/routes/_index.tsx": "/",
      "app/routes/reviews.$id.tsx": "/reviews/:id",
      "app/routes/_auth.login.tsx": "/login",
      "app/routes/settings/route.tsx": "/settings",
    });
  });

  it("BL-35 no root file, no routes: an ordinary app/ or routes/ folder is never read as routes", () => {
    expect(detectFileRoutes(["app/page.tsx", "app/utils.ts", "src/routes/x.tsx"])).toEqual([]);
  });

  it("BL-35b overlapping roots give each file one route, root files are never routes, and roots are capped", () => {
    expect(
      map(["app/_layout.tsx", "app/root.tsx", "app/routes/a.tsx", "app/settings.tsx"]),
    ).toEqual({ "app/routes/a.tsx": "/a", "app/settings.tsx": "/settings" });
    const many = Array.from({ length: 50 }, (_, i) => `d${i}/app/_layout.tsx`);
    const screens = Array.from({ length: 50 }, (_, i) => `d${i}/app/home.tsx`);
    expect(detectFileRoutes([...many, ...screens])).toHaveLength(20);
  });
});
