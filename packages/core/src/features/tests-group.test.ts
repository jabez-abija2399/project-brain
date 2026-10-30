import { describe, expect, it } from "vitest";
import { featureFromPath, groupFeatures } from "./group";

// Dogfooding (edutech): test-only folders never become features; their files go to one "tests" group.
const TEST_FOLDERS = [
  "__mocks__",
  "__tests__",
  "__fixtures__",
  "fixtures",
  "test",
  "tests",
  "e2e",
  "cypress",
  "playwright",
];
const file = (path: string, imports: string[] = []) => ({
  path,
  imports: imports.map((resolved) => ({ resolved })),
});

describe("test-only folders", () => {
  it("every test-only folder's files go to the tests group, wherever the folder is", () => {
    for (const folder of TEST_FOLDERS) {
      for (const path of [
        `${folder}/home.spec.ts`,
        `src/${folder}/api.ts`,
        `src/components/reviews/${folder}/List.test.tsx`,
        `apps/web/${folder}/login.ts`,
      ]) {
        expect([path, featureFromPath(path)]).toEqual([path, "@tests"]);
      }
    }
  });

  it("no feature is named after a test folder, and the tests group is named tests", () => {
    const map = groupFeatures([
      file("src/app/page.tsx"),
      file("src/components/reviews/List.tsx"),
      ...TEST_FOLDERS.map((f) => file(`${f}/x.spec.ts`)),
      file("src/__mocks__/supabase.ts"),
    ]);
    // Apart from the tests group itself, no feature is named after a test folder.
    const names = map.features.filter((f) => f.key !== "@tests").map((f) => f.name);
    for (const folder of TEST_FOLDERS) expect(names).not.toContain(folder);
    const tests = map.features.find((f) => f.key === "@tests");
    expect(tests?.name).toBe("tests");
    expect(tests?.files).toHaveLength(TEST_FOLDERS.length + 1);
  });

  it("a component that a page and a test both import stays with the page (tests never claim app code)", () => {
    const map = groupFeatures([
      file("src/app/billing/page.tsx", ["src/components/PlanCard.tsx"]),
      file("tests/billing.spec.ts", ["src/components/PlanCard.tsx"]),
      file("e2e/billing.spec.ts", ["src/components/PlanCard.tsx"]),
      file("cypress/plan.cy.ts", ["src/components/PlanCard.tsx"]),
      file("src/components/PlanCard.tsx"),
      file("src/lib/only-tests.ts"),
      file("__tests__/only.test.ts", ["src/lib/only-tests.ts"]),
    ]);
    const where = (path: string) =>
      map.features.find((f) => f.files.includes(path))?.key ??
      (map.shared.some((s) => s.path === path) ? "shared" : null);
    expect(where("src/components/PlanCard.tsx")).toBe("billing");
    // A file only tests use is not app code of any feature.
    expect(where("src/lib/only-tests.ts")).toBe("@other");
  });

  it("folder names that merely contain a test word are not test folders", () => {
    expect(featureFromPath("src/components/testimonials/Quote.tsx")).toBe("testimonials");
    expect(featureFromPath("src/components/latest/List.tsx")).toBe("latest");
  });
});
