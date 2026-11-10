import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Roadmap Phase 9 (CI fix): a client component ("use client") must never import the @brain/core barrel or
// @brain/db. They hold server-only code (node:path, node:crypto, the database), which breaks the browser build.
const SRC = fileURLToPath(new URL("..", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : files(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("client components", () => {
  it("PH9-20 no client component imports @brain/core or @brain/db", () => {
    const client = files(SRC).filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
    expect(client.length).toBeGreaterThan(5);
    const bad = client.filter((f) =>
      /from\s+["']@brain\/(core|db)["']/.test(readFileSync(f, "utf8")),
    );
    expect(bad.map((f) => relative(SRC, f))).toEqual([]);
  });
});
