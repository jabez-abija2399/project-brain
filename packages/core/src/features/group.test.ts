import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type IndexResult, indexRepo } from "../indexer";
import { type FeatureMap, featureFromPath, groupFeatures } from "./group";

const fixtures = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
  "tests/fixtures",
);
const fixtureRoot = join(fixtures, "feature-app");

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
        key: "auth",
        name: "auth",
        files: [
          "src/app/api/auth/callback/route.ts",
          "src/components/auth/LoginForm.tsx",
          "src/lib/session.ts",
        ],
      },
      {
        key: "billing",
        name: "billing",
        files: [
          "src/app/api/billing/webhook/route.ts",
          "src/app/billing/page.tsx",
          "src/components/billing/PlanPicker.tsx",
          "src/lib/stripe.ts",
        ],
      },
      { key: "@home", name: "home", files: ["src/app/layout.tsx", "src/app/page.tsx"] },
      // The (auth) route group is skipped like in the URL: /login names the feature.
      { key: "login", name: "login", files: ["src/app/(auth)/login/page.tsx"] },
      {
        key: "reviews",
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
        { key: "alpha", name: "alpha", files: ["src/components/alpha/A.tsx", "src/lib/money.ts"] },
        { key: "@other", name: "other", files: ["scripts/seed.ts"] },
        { key: "zeta", name: "zeta", files: ["src/components/zeta/Z.tsx"] },
      ],
      shared: [],
    });
  });

  it("AC-006-02 files used by 3 or more features are marked shared, also through another shared file", () => {
    expect(map.shared).toEqual([
      { path: "src/components/ui/Button.tsx", usedBy: ["@home", "auth", "billing", "reviews"] },
      { path: "src/lib/cn.ts", usedBy: ["@home", "auth", "billing", "reviews"] },
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

  it("AC-006-01 automatic features (home, other) never merge with a real folder of the same name", () => {
    const result = groupFeatures([
      { path: "src/app/page.tsx", imports: [] },
      { path: "src/components/home/Hero.tsx", imports: [] },
      { path: "src/components/other/Misc.tsx", imports: [] },
      { path: "scripts/seed.ts", imports: [] },
    ]);
    expect(result.features).toEqual([
      { key: "@home", name: "home", files: ["src/app/page.tsx"] },
      { key: "home", name: "home", files: ["src/components/home/Hero.tsx"] },
      { key: "@other", name: "other", files: ["scripts/seed.ts"] },
      { key: "other", name: "other", files: ["src/components/other/Misc.tsx"] },
    ]);
  });

  it("AC-006-07 only app/ or src/app/ at the project root is the Next.js app folder", () => {
    expect(featureFromPath("app/reviews/page.tsx")).toBe("reviews");
    expect(featureFromPath("src/app/(dashboard)/billing/page.tsx")).toBe("billing");
    expect(featureFromPath("src/app/page.tsx")).toBe("@home");
    expect(featureFromPath("src/components/app/Header.tsx")).toBeNull();
    expect(featureFromPath("packages/app/src/lib/x.ts")).toBeNull();
    expect(featureFromPath("lib/app/page.tsx")).toBeNull();
  });
});

describe("FEAT-006 groupFeatures on other layouts", () => {
  async function groupFixture(name: string) {
    const index = await indexRepo(join(fixtures, name));
    const map = groupFeatures(index.files);
    const placed = [...map.features.flatMap((f) => f.files), ...map.shared.map((s) => s.path)];
    expect(placed.sort()).toEqual(index.files.map((f) => f.path).sort());
    return map;
  }

  it("AC-006-07 Next.js route groups are skipped: the folder inside the group names the feature", async () => {
    expect(await groupFixture("route-groups-app")).toEqual({
      features: [
        { key: "billing", name: "billing", files: ["src/app/(dashboard)/billing/page.tsx"] },
        {
          key: "@home",
          name: "home",
          files: [
            "src/app/(dashboard)/layout.tsx",
            "src/app/(marketing)/page.tsx",
            "src/app/layout.tsx",
          ],
        },
        // components/home is a real folder: it stays apart from the automatic home feature.
        { key: "home", name: "home", files: ["src/components/home/Hero.tsx"] },
        { key: "login", name: "login", files: ["src/app/(auth)/login/page.tsx"] },
        { key: "projects", name: "projects", files: ["src/app/(protected)/projects/page.tsx"] },
        {
          key: "reviews",
          name: "reviews",
          files: [
            "src/app/(dashboard)/reviews/[id]/page.tsx",
            "src/app/(dashboard)/reviews/page.tsx",
            // components/app is not the app folder; the file follows its importers
            "src/components/app/Header.tsx",
            "src/components/reviews/ReviewList.tsx",
          ],
        },
        { key: "settings", name: "settings", files: ["src/app/(dashboard)/settings/page.tsx"] },
      ],
      shared: [
        { path: "src/lib/supabase.ts", usedBy: ["billing", "projects", "reviews", "settings"] },
      ],
    });
  });

  it("AC-006-07 the Next.js Pages Router is grouped by its routes, API routes included", async () => {
    expect(await groupFixture("pages-router-app")).toEqual({
      features: [
        {
          key: "billing",
          name: "billing",
          files: [
            "components/billing/PlanPicker.tsx",
            "lib/stripe.ts",
            "pages/api/billing/webhook.ts",
            "pages/billing.tsx",
          ],
        },
        { key: "@home", name: "home", files: ["pages/_app.tsx", "pages/index.tsx"] },
        {
          key: "reviews",
          name: "reviews",
          files: ["pages/api/reviews.ts", "pages/reviews/[id].tsx", "pages/reviews/index.tsx"],
        },
      ],
      shared: [],
    });
  });

  it("AC-006-07 a Vite/React app (Lovable layout) is grouped by its pages and feature folders", async () => {
    expect(await groupFixture("vite-app")).toEqual({
      features: [
        {
          key: "billing",
          name: "billing",
          files: [
            "src/components/PricingTable.tsx",
            "src/hooks/use-toast.ts",
            "src/pages/Billing.tsx",
          ],
        },
        {
          key: "@home",
          name: "home",
          files: ["src/App.tsx", "src/main.tsx", "src/pages/Index.tsx", "src/pages/NotFound.tsx"],
        },
        {
          key: "reviews",
          name: "reviews",
          files: ["src/components/reviews/ReviewCard.tsx", "src/pages/Reviews.tsx"],
        },
        {
          key: "settings",
          name: "settings",
          files: ["src/features/settings/SettingsForm.tsx", "src/pages/Settings.tsx"],
        },
      ],
      shared: [
        { path: "src/components/Navbar.tsx", usedBy: ["@home", "billing", "reviews", "settings"] },
        {
          path: "src/components/ui/button.tsx",
          usedBy: ["@home", "billing", "reviews", "settings"],
        },
        { path: "src/integrations/supabase/client.ts", usedBy: ["billing", "reviews", "settings"] },
        { path: "src/lib/utils.ts", usedBy: ["@home", "billing", "reviews", "settings"] },
      ],
    });
  });

  it("AC-006-07 page file names in PascalCase match feature folders in kebab-case", () => {
    expect(featureFromPath("src/pages/UserProfile.tsx")).toBe("user-profile");
    expect(featureFromPath("src/features/user-profile/Card.tsx")).toBe("user-profile");
    expect(featureFromPath("src/pages/NotFound.tsx")).toBe("@home");
  });
});
