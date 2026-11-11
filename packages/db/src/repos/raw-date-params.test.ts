import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 2026-11-11 production: `sql\`${col} > ${now}\`` sent a JS Date to the Postgres driver, which wrote it with
// Date.toString() ("Wed Nov 11 2026 ... (Coordinated Universal Time)"); Postgres refused it and the GitHub callback
// answered 500. PGlite accepts that text, so no other test saw it. Dates go through column helpers (gt, lt, eq ...),
// which send ISO strings, or explicitly as `.toISOString()`.
const dir = fileURLToPath(new URL(".", import.meta.url));
const DATE_NAME = /\$\{(now|since|before|until|cutoff|start|end|[a-z]+At)\}/;

describe("dates in raw SQL", () => {
  it("BL-54 no repository passes a Date variable straight into a sql template", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    )) {
      const text = readFileSync(join(dir, file), "utf8");
      for (const m of text.matchAll(/sql`([^`]*)`/g)) {
        if (DATE_NAME.test(m[1] ?? "")) offenders.push(`${file}: ${m[0].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
