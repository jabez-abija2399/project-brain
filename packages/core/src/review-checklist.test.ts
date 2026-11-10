import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LONG_FILE_LINES,
  REVIEW_RULES,
  type ReviewFile,
  maintainabilityFlags,
  reviewChecklist,
} from "./review-checklist";

// Roadmap Phase 7: the build checklist as a rule pack, and maintainability flags. Paths and added lines only.
const file = (path: string, after: string | null, before: string | null = null): ReviewFile => ({
  path,
  before,
  after,
});
const ids = (files: ReviewFile[]) => reviewChecklist(files).map((i) => i.id);

describe("Phase 7: review checklist", () => {
  it("PH7-01 the eight rules are the headings of docs/build-checklist.md, in order", () => {
    const doc = readFileSync(new URL("../../../docs/build-checklist.md", import.meta.url), "utf8");
    const headings = [...doc.matchAll(/^\d+\. \*\*(.+?)\*\*$/gm)].map((m) => m[1]);
    expect(REVIEW_RULES.map((r) => r.title)).toEqual(headings);
    expect(REVIEW_RULES.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("PH7-02 an API route that loops and catches errors gets rules 1, 2 and 4; a migration gets 1 and 7", () => {
    const route = file(
      "apps/web/src/app/api/items/route.ts",
      "export async function GET() {\n  try { for (const x of xs) use(x); } catch { return null; }\n}\n",
    );
    expect(ids([route])).toEqual([1, 2, 4]);
    expect(ids([file("packages/db/migrations/0056_x.sql", "CREATE TABLE x (id int);\n")])).toEqual([
      1, 6, 7,
    ]);
  });

  it("PH7-03 a test with real waiting gets rule 8; a tidy test and a README get nothing", () => {
    expect(ids([file("src/a.test.ts", "await new Promise((r) => setTimeout(r, 50));\n")])).toEqual([
      8,
    ]);
    expect(ids([file("src/a.test.ts", "expect(add(1, 2)).toBe(3);\n")])).toEqual([]);
    expect(ids([file("README.md", "Hello\n")])).toEqual([]);
  });

  it("PH7-04 only added lines count: an unchanged token line in an edited file does not raise rule 3", () => {
    const before = "const token = read();\nexport const a = 1;\n";
    expect(ids([file("src/lib/util.ts", `${before}export const b = 2;\n`, before)])).toEqual([]);
    expect(ids([file("src/lib/util.ts", `${before}console.log(token);\n`, before)])).toEqual([3]);
  });

  it("PH7-05 a parser gets rule 5; an indexer that upserts gets rule 6; deleted files are skipped", () => {
    expect(ids([file("src/parse-config.ts", "export const x = 1;\n")])).toEqual([5]);
    expect(
      ids([file("src/server/index-sync.ts", "await db.insert(t).onConflictDoNothing();\n")]),
    ).toEqual([1, 5, 6, 7]);
    expect(ids([file("src/server/route.ts", null, "old")])).toEqual([]);
  });

  it("PH7-06 attack: control characters in a path never reach the output; at most 5 files per rule", () => {
    const esc = String.fromCharCode(27);
    const items = reviewChecklist([file(`src/api/a${esc}[2Jb.ts`, "x\n")]);
    expect(items[0]?.files[0]).not.toContain(esc);
    const many = Array.from({ length: 9 }, (_, n) => file(`src/api/f${n}.ts`, "x\n"));
    expect(reviewChecklist(many)[0]?.files).toHaveLength(5);
  });
});

describe("Phase 7: maintainability flags", () => {
  const body = (n: number) => `${Array.from({ length: n }, (_, i) => `l${i}`).join("\n")}\n`;

  it("PH7-07 a file this change made longer than 300 lines is flagged; an untouched-length long file and JSON are not", () => {
    const flags = maintainabilityFlags([file("src/big.ts", body(LONG_FILE_LINES + 5))]);
    expect(flags.map((f) => [f.kind, f.file])).toEqual([["long_file", "src/big.ts"]]);
    const old = body(LONG_FILE_LINES + 5);
    const same = old.replace("l3\n", "x3\n");
    expect(maintainabilityFlags([file("src/big.ts", same, old)])).toEqual([]);
    expect(maintainabilityFlags([file("data/big.json", body(LONG_FILE_LINES + 5))])).toEqual([]);
  });

  it("PH7-08 more than 20 files is flagged; a small change has no flags", () => {
    const many = Array.from({ length: 21 }, (_, n) => file(`src/f${n}.ts`, "x\n"));
    expect(maintainabilityFlags(many).map((f) => f.kind)).toEqual(["many_files"]);
    expect(maintainabilityFlags([file("src/a.ts", "x\n")])).toEqual([]);
  });

  it("PH7-09 attack: thousands of long files give at most 20 flags", () => {
    const files = Array.from({ length: 2000 }, (_, n) =>
      file(`src/f${n}.ts`, body(LONG_FILE_LINES + 1)),
    );
    const flags = maintainabilityFlags(files);
    expect(flags.length).toBeLessThanOrEqual(20);
    expect(flags.map((f) => f.kind)).toContain("large_change");
    expect(flags.map((f) => f.kind)).toContain("many_files");
  });
});

describe("Phase 7: review output is safe to show an agent", () => {
  it("PH7-17 attack (security review): hidden tag characters, a secret in a path and a huge path never reach the output", () => {
    const tag = String.fromCodePoint(0xe0041);
    const key = ["sk", "_live_", "Q7xT2mK9vR4wZp8aB3dE5gH7"].join("");
    const items = reviewChecklist([
      file(`src/api/a${tag}b.ts`, "x\n"),
      file(`src/api/${key}.ts`, "x\n"),
      file(`src/api/${"d".repeat(5000)}.ts`, "x\n"),
    ]);
    const shown = items.flatMap((i) => i.files);
    expect(shown).toHaveLength(3);
    for (const p of shown) {
      expect(p).not.toContain(tag);
      expect(p).not.toContain(key);
      expect(p.length).toBeLessThanOrEqual(300);
    }
    const flags = maintainabilityFlags([file(`src/${key}.ts`, "x\n".repeat(LONG_FILE_LINES + 1))]);
    expect(flags[0]?.file).not.toContain(key);
  });
});
