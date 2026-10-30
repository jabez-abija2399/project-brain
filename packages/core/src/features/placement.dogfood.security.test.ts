import { describe, expect, it } from "vitest";
import { featureFromPath, groupFeatures } from "./group";

// Independent security review of D-023 (4): the tests group must not swallow real app code, and lookalike folder names
// must not get the test pass. Lookalike characters only as escapes.
const file = (path: string, imports: string[] = []) => ({
  path,
  imports: imports.map((resolved) => ({ resolved })),
});

describe("tests group placement", () => {
  it("attack: lookalike, cased or padded test folder names are not test code", () => {
    for (const path of [
      "src/t\u0435sts/charge.ts", // Cyrillic e
      "src/\uff54\uff45\uff53\uff54\uff53/charge.ts", // fullwidth "tests"
      "src/\u0442ests/charge.ts", // Cyrillic te
      "src/Tests/charge.ts",
      "src/tests\u200b/charge.ts",
      "src/tests /charge.ts",
      "src/my-tests/charge.ts",
      "src/fixtures.ts",
      "src/tests", // a file named tests, not a folder
    ]) {
      expect([path, featureFromPath(path)]).not.toEqual([path, "@tests"]);
    }
  });

  it("attack: a test that imports app code never pulls that code into the tests group", () => {
    const map = groupFeatures([
      file("src/components/billing/charge.ts"),
      file("src/lib/stripe-helper.ts"),
      file("tests/billing.spec.ts", [
        "src/lib/stripe-helper.ts",
        "src/components/billing/charge.ts",
      ]),
    ]);
    const tests = map.features.find((f) => f.key === "@tests");
    expect(tests?.files).toEqual(["tests/billing.spec.ts"]);
  });

  it("attack: Next.js route files under a folder named test/e2e/fixtures are app code, not the tests group", () => {
    // These are public pages and API handlers; putting them in the tests group makes receipts call them in scope
    // for any request (receipt.ts isTestCode).
    for (const path of [
      "src/app/api/test/route.ts",
      "app/e2e/page.tsx",
      "src/app/(admin)/fixtures/page.tsx",
      "pages/api/tests/reset.ts",
      "src/app/test/layout.tsx",
    ]) {
      expect([path, featureFromPath(path)]).not.toEqual([path, "@tests"]);
    }
  });
});
