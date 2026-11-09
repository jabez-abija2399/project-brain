import { describe, expect, it } from "vitest";
import { MATCH_BUDGET, MAX_BOUNDARY_HITS, checkBoundaries, globMatch } from "./boundary-check";

describe("Blueprint boundaries checked on a receipt (roadmap Phase 4c)", () => {
  it("PH4C-01 glob patterns: ** crosses folders, * and ? stay within one, a bare name matches anywhere", () => {
    expect(globMatch("supabase/migrations/**", "supabase/migrations/2024/01_init.sql")).toBe(true);
    expect(globMatch("src/*.ts", "src/a.ts")).toBe(true);
    expect(globMatch("src/*.ts", "src/lib/a.ts")).toBe(false);
    expect(globMatch("src/?.ts", "src/a.ts")).toBe(true);
    expect(globMatch(".env*", "apps/web/.env.local")).toBe(true);
    expect(globMatch("src/**/secret.ts", "src/secret.ts")).toBe(true);
    expect(globMatch("src/**/secret.ts", "lib/secret.ts")).toBe(false);
    expect(globMatch("@aws-sdk/*", "@aws-sdk/client-s3")).toBe(true);
  });

  it("PH4C-02 protected paths, disallowed packages and packages off the allowed list are reported", () => {
    const hits = checkBoundaries({
      files: ["supabase/migrations/02_rls.sql", "src/app/page.tsx"],
      dependencies: ["lodash", "@aws-sdk/client-s3", "zod"],
      boundaries: [
        { kind: "protected_path", pattern: "supabase/migrations/**" },
        { kind: "disallowed_dependency", pattern: "lodash" },
        { kind: "allowed_dependency", pattern: "zod" },
        { kind: "allowed_dependency", pattern: "lodash" },
      ],
    });
    expect(hits).toEqual([
      {
        kind: "protected_path",
        subject: "supabase/migrations/02_rls.sql",
        pattern: "supabase/migrations/**",
      },
      { kind: "disallowed_dependency", subject: "lodash", pattern: "lodash" },
      { kind: "not_allowed_dependency", subject: "@aws-sdk/client-s3", pattern: "" },
    ]);
  });

  it("PH4C-03 no boundaries, no hits; the list is capped; a hostile pattern cannot slow matching down", () => {
    expect(checkBoundaries({ files: ["a.ts"], dependencies: ["x"], boundaries: [] })).toEqual([]);
    const many = Array.from({ length: 100 }, (_, i) => `locked/f${i}.ts`);
    expect(
      checkBoundaries({
        files: many,
        dependencies: [],
        boundaries: [{ kind: "protected_path", pattern: "locked/**" }],
      }),
    ).toHaveLength(MAX_BOUNDARY_HITS);
    const started = Date.now();
    expect(globMatch(`${"*".repeat(100)}b`, "a".repeat(400))).toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it("PH4C-07 folders are matched however the owner types them; **/ only continues at a folder start", () => {
    for (const p of ["./supabase/**", "/supabase/**", "supabase/", "supabase", "Supabase/**"]) {
      expect(globMatch(p, "supabase/a.sql"), p).toBe(true);
    }
    expect(globMatch("**/.env", "config.env")).toBe(false);
    expect(globMatch("**/.env", "apps/web/.env")).toBe(true);
    expect(globMatch("src/**/secret.ts", "src/mysecret.ts")).toBe(false);
  });

  it("PH4C-08 attack: crafted long paths and patterns stay within a work budget", () => {
    const patterns = Array.from({ length: 50 }, (_, i) => ({
      kind: "protected_path",
      pattern: `${"a/*?".repeat(49)}${i}`,
    }));
    const files = Array.from({ length: 300 }, (_, i) => `${"a/".repeat(510)}${i}`);
    const started = Date.now();
    const hits = checkBoundaries({ files, dependencies: [], boundaries: patterns });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(hits).toEqual([]);
    expect(MATCH_BUDGET).toBeGreaterThan(0);
  });
});
