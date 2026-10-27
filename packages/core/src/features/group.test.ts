import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type IndexResult, indexRepo } from "../indexer";
import { type FeatureMap, groupFeatures } from "./group";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
  "tests/fixtures/feature-app",
);

function imp(resolved: string) {
  return { from: "", to: resolved, resolved, outside: false, line: 1, external: false };
}

describe("FEAT-006 groupFeatures", () => {
  let index: IndexResult;
  let map: FeatureMap;

  beforeAll(async () => {
    index = await indexRepo(fixtureRoot);
    map = groupFeatures(index.files);
  });

  it("AC-006-01 groups the fixture app into features from routes and folders, each file in exactly one primary feature", () => {
    expect(map.features).toEqual([
      {
        name: "auth",
        files: [
          "src/app/(auth)/login/page.tsx",
          "src/app/api/auth/callback/route.ts",
          "src/components/auth/LoginForm.tsx",
          "src/lib/session.ts",
        ],
      },
      {
        name: "billing",
        files: [
          "src/app/api/billing/webhook/route.ts",
          "src/app/billing/page.tsx",
          "src/components/billing/PlanPicker.tsx",
          "src/lib/stripe.ts",
        ],
      },
      { name: "home", files: ["src/app/layout.tsx", "src/app/page.tsx"] },
      {
        name: "reviews",
        files: [
          "src/app/reviews/[id]/page.tsx",
          "src/app/reviews/page.tsx",
          "src/components/reviews/ReviewCard.tsx",
          "src/components/reviews/ReviewList.tsx",
          // used by reviews (2 importing files) and billing (1): the larger user wins
          "src/lib/format.ts",
        ],
      },
    ]);
    const placed = [...map.features.flatMap((f) => f.files), ...map.shared.map((s) => s.path)];
    expect(placed.sort()).toEqual(index.files.map((f) => f.path).sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("AC-006-01 a file used by two features gets one primary feature; ties go alphabetically", () => {
    const tied = groupFeatures([
      { path: "src/components/zeta/Z.tsx", imports: [imp("src/lib/money.ts")] },
      { path: "src/components/alpha/A.tsx", imports: [imp("src/lib/money.ts")] },
      { path: "src/lib/money.ts", imports: [] },
      { path: "scripts/seed.ts", imports: [] },
    ]);
    expect(tied).toEqual({
      features: [
        { name: "alpha", files: ["src/components/alpha/A.tsx", "src/lib/money.ts"] },
        { name: "other", files: ["scripts/seed.ts"] },
        { name: "zeta", files: ["src/components/zeta/Z.tsx"] },
      ],
      shared: [],
    });
  });

  it("AC-006-02 files used by 3 or more features are marked shared, also through another shared file", () => {
    expect(map.shared).toEqual([
      { path: "src/components/ui/Button.tsx", usedBy: ["auth", "billing", "home", "reviews"] },
      { path: "src/lib/cn.ts", usedBy: ["auth", "billing", "home", "reviews"] },
    ]);
    const primaryFiles = map.features.flatMap((f) => f.files);
    expect(primaryFiles).not.toContain("src/components/ui/Button.tsx");
    expect(primaryFiles).not.toContain("src/lib/cn.ts");
  });

  it("AC-006-02 a file used by exactly 3 features is shared, by 2 is not", () => {
    const result = groupFeatures([
      { path: "src/features/a/A.ts", imports: [imp("src/lib/three.ts"), imp("src/lib/two.ts")] },
      { path: "src/features/b/B.ts", imports: [imp("src/lib/three.ts"), imp("src/lib/two.ts")] },
      { path: "src/features/c/C.ts", imports: [imp("src/lib/three.ts")] },
      { path: "src/lib/three.ts", imports: [] },
      { path: "src/lib/two.ts", imports: [] },
    ]);
    expect(result.shared).toEqual([{ path: "src/lib/three.ts", usedBy: ["a", "b", "c"] }]);
    expect(result.features.find((f) => f.name === "a")?.files).toEqual([
      "src/features/a/A.ts",
      "src/lib/two.ts",
    ]);
  });
});
