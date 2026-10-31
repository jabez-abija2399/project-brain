import { describe, expect, it } from "vitest";
import { summarizeDiff, summarizeNewFile } from "./change-summary";

// Change summaries (D-025): what changed in a file, computed on the user's machine from git's diff. Counts, names and
// places only: never a line of the source text.
const diff = (body: string) =>
  [
    "diff --git a/src/app/page.tsx b/src/app/page.tsx",
    "index 1111111..2222222 100644",
    "--- a/src/app/page.tsx",
    "+++ b/src/app/page.tsx",
    body,
  ].join("\n");

describe("change summaries", () => {
  it("the edutech case: one comment line added at the top of the main page", () => {
    const got = summarizeDiff(
      "src/app/page.tsx",
      diff("@@ -0,0 +1 @@\n+// Main page: lists the courses for the signed-in student"),
      12,
    );
    expect(got).toEqual({
      path: "src/app/page.tsx",
      added: 1,
      removed: 0,
      comment_only: true,
      imports_changed: false,
      symbols_added: [],
      symbols_removed: [],
      symbols_changed: [],
      where: ["top of file"],
    });
    expect(JSON.stringify(got)).not.toContain("courses");
  });

  it("names symbols added, removed and changed, imports and the lines changed", () => {
    const got = summarizeDiff(
      "src/lib/reviews.ts",
      diff(
        [
          "@@ -1 +1,2 @@",
          '-import { a } from "./a";',
          '+import { a, b } from "./a";',
          '+import { z } from "zod";',
          "@@ -20,3 +21,0 @@ export function oldHelper() {",
          "-export function oldHelper() {",
          "-  return 1;",
          "-}",
          "@@ -40,2 +40,6 @@ export async function averageRating(reviews: Review[]) {",
          "-  return 0;",
          "-  // todo",
          "+  const total = reviews.reduce((s, r) => s + r.stars, 0);",
          "+  return total / reviews.length;",
          "+}",
          "+export const MAX_STARS = 5;",
          "+class Summary {}",
          "+  return 0;",
        ].join("\n"),
      ),
      45,
    );
    expect(got).toMatchObject({
      added: 8,
      removed: 6,
      comment_only: false,
      imports_changed: true,
      symbols_added: ["MAX_STARS", "Summary"],
      symbols_removed: ["oldHelper"],
      symbols_changed: ["averageRating"],
      where: ["top of file", "line 20", "lines 40-45", "end of file"],
    });
  });

  it("a new file counts every line as added; a deleted or binary file says so", () => {
    expect(summarizeNewFile("src/a.ts", "export function a() {}\n\nexport const b = 1;\n")).toEqual(
      {
        path: "src/a.ts",
        added: 3,
        removed: 0,
        comment_only: false,
        imports_changed: false,
        symbols_added: ["a", "b"],
        symbols_removed: [],
        symbols_changed: [],
        where: ["new file"],
      },
    );
    const deleted = summarizeDiff(
      "src/old.ts",
      [
        "diff --git a/src/old.ts b/src/old.ts",
        "deleted file mode 100644",
        "--- a/src/old.ts",
        "+++ /dev/null",
        "@@ -1,2 +0,0 @@",
        "-export const old = 1;",
        "-export const older = 2;",
      ].join("\n"),
      0,
    );
    expect(deleted).toMatchObject({
      removed: 2,
      symbols_removed: ["old", "older"],
      where: ["deleted file"],
    });
    expect(
      summarizeDiff(
        "logo.png",
        "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ",
        0,
      ),
    ).toMatchObject({ added: 0, removed: 0, where: ["binary file"] });
  });

  it("attack: a secret-shaped symbol name is masked, odd names are dropped, and every list is capped", () => {
    const secret = ["sk_", "live_", "4eC39Hq", "LyjWDarj", "Ab12"].join("");
    const many = Array.from({ length: 40 }, (_, i) => `+export const name${i} = ${i};`).join("\n");
    const got = summarizeDiff(
      "src/x.ts",
      diff(`@@ -0,0 +1,42 @@\n+const ${secret} = 1;\n+const \u202eevil = 2;\n${many}`),
      42,
    );
    expect(JSON.stringify(got)).not.toContain(secret);
    expect(JSON.stringify(got)).not.toContain("\u202e");
    expect(got.symbols_added.length).toBeLessThanOrEqual(20);
    const hunks = Array.from(
      { length: 30 },
      (_, i) => `@@ -${i * 10 + 5} +${i * 10 + 5} @@\n-a\n+b`,
    ).join("\n");
    expect(summarizeDiff("src/y.ts", diff(hunks), 400).where.length).toBeLessThanOrEqual(6);
  });
});
