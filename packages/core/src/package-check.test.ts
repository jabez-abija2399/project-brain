import { describe, expect, it } from "vitest";
import {
  type PackageSummary,
  addedDependencies,
  assessPackage,
  isValidPackageName,
  summarizePackument,
} from "./package-check";

const now = new Date("2026-10-29T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

function packument(
  name: string,
  opts: { created?: string; repo?: unknown; times?: Record<string, string> } = {},
) {
  const times = opts.times ?? { "3.0.0": daysAgo(400), "3.1.0": daysAgo(60) };
  const versions = Object.keys(times);
  return {
    name,
    versions: Object.fromEntries(versions.map((v) => [v, { name, version: v }])),
    "dist-tags": { latest: versions[versions.length - 1] },
    time: { created: opts.created ?? daysAgo(2000), modified: daysAgo(1), ...times },
    repository:
      "repo" in opts
        ? opts.repo
        : { type: "git", url: "git+https://github.com/colinhacks/zod.git" },
  };
}
const summary = (doc: unknown, name = "zod") => summarizePackument(doc, name) as PackageSummary;

describe("check_package rules (FEAT-014)", () => {
  it("AC-014-01 an established package with a repository is EXISTS with age, last release and repository link", () => {
    const check = assessPackage("zod", summary(packument("zod")), null, now);
    expect(check).toMatchObject({
      status: "EXISTS",
      recommendation: "ok_to_install",
      latest: "3.1.0",
      created: daysAgo(2000),
      last_release: daysAgo(60),
      repository: "git+https://github.com/colinhacks/zod.git",
      version: "3.1.0",
      suggested_version: null,
      warnings: [],
    });
  });

  it("AC-014-02 a name the registry does not know is NOT_FOUND and must not be installed", () => {
    expect(assessPackage("reactt-dom-utilz", "not_found", null, now)).toMatchObject({
      status: "NOT_FOUND",
      recommendation: "do_not_install",
    });
  });

  it("AC-014-03 a package first published 29 days ago, or one without a repository link, is RISKY", () => {
    const young = assessPackage(
      "zod",
      summary(packument("zod", { created: daysAgo(29) })),
      null,
      now,
    );
    expect(young.status).toBe("RISKY");
    expect(young.warnings).toContain("the package was first published 29 day(s) ago");
    const thirty = assessPackage(
      "zod",
      summary(packument("zod", { created: daysAgo(30) })),
      null,
      now,
    );
    expect(thirty.status).toBe("EXISTS");
    for (const repo of [undefined, "", "javascript:alert(1)", { url: "not a link at all" }, 42]) {
      const check = assessPackage("zod", summary(packument("zod", { repo })), null, now);
      expect(check.status).toBe("RISKY");
      expect(check.repository).toBeNull();
      expect(check.warnings).toContain("no repository link");
    }
    expect(summary(packument("zod", { repo: "github:colinhacks/zod" })).repository).toBe(
      "github:colinhacks/zod",
    );
  });

  it("AC-014-04 attack: a known AI-invented name is flagged as do-not-install even though someone registered it", () => {
    const check = assessPackage(
      "react-codeshift",
      summary(packument("react-codeshift"), "react-codeshift"),
      null,
      now,
    );
    expect(check.status).toBe("RISKY");
    expect(check.recommendation).toBe("do_not_install");
    expect(check.warnings[0]).toMatch(/known list of AI-invented package names/);
    expect(assessPackage("React-Codeshift", "not_found", null, now).warnings).toHaveLength(2);
  });

  it("AC-014-06 versions younger than the 7-day cooldown (2 and 5 days) are flagged and the newest older stable version is suggested", () => {
    const times = {
      "3.0.0": daysAgo(400),
      "3.2.0": daysAgo(20),
      "3.2.1": daysAgo(10),
      "4.0.0-beta.1": daysAgo(9),
      "3.3.0": daysAgo(5),
      "3.4.0": daysAgo(2),
    };
    const s = summary(packument("zod", { times }));
    const latest = assessPackage("zod", s, null, now);
    expect(latest).toMatchObject({ status: "RISKY", version: "3.4.0", suggested_version: "3.2.1" });
    expect(latest.recommendation).toBe("review_before_installing");
    expect(latest.warnings).toContain(
      "version 3.4.0 was published 2 day(s) ago (release cooldown 7 days): install 3.2.1 instead",
    );
    expect(assessPackage("zod", s, "3.3.0", now)).toMatchObject({
      status: "RISKY",
      suggested_version: "3.2.1",
    });
    expect(assessPackage("zod", s, "3.2.1", now)).toMatchObject({
      status: "EXISTS",
      suggested_version: null,
    });
    const missing = assessPackage("zod", s, "9.9.9", now);
    expect(missing).toMatchObject({ status: "RISKY", recommendation: "do_not_install" });
    const allNew = summary(
      packument("zod", { created: daysAgo(400), times: { "1.0.0": daysAgo(1) } }),
    );
    expect(assessPackage("zod", allNew, null, now).warnings[0]).toMatch(
      /no older stable version exists; wait$/,
    );
  });

  it("AC-014-07 attack: malformed registry documents are not usable (null), and unreachable is never called safe", () => {
    const good = packument("zod");
    const bad: unknown[] = [
      null,
      [],
      "zod",
      42,
      { ...good, name: "other" },
      { ...good, time: null },
      { ...good, "dist-tags": {} },
      { ...good, "dist-tags": { latest: "../../x" } },
      { ...good, "dist-tags": { latest: "9.9.9" } },
      { ...good, time: { ...good.time, created: "yesterday-ish" } },
      { ...good, time: { ...good.time, created: 1 } },
    ];
    for (const doc of bad) expect(summarizePackument(doc, "zod")).toBeNull();
    expect(assessPackage("zod", "unreachable", null, now)).toMatchObject({
      status: "UNREACHABLE",
      recommendation: "verify_manually",
    });
  });

  it("AC-014-07 attack: crafted names that could change the registry URL are not valid package names", () => {
    for (const ok of ["zod", "@types/node", "JSONStream", "lodash.merge", "-", "a".repeat(214)]) {
      expect(isValidPackageName(ok)).toBe(true);
    }
    const crafted = [
      "",
      "../zod",
      "..",
      ".hidden",
      "_private",
      "zod?write=1",
      "zod#x",
      "zod/../../-/user",
      "@scope/",
      "@a/b/c",
      "%2e%2e",
      " zod",
      "zod\n",
      "zod@1.0.0",
      "https://evil.example/x",
      "node_modules",
      "a".repeat(215),
    ];
    for (const name of crafted) expect(isValidPackageName(name), name).toBe(false);
  });

  it("AC-014-05 lists the dependencies a package.json change adds, following npm: aliases and skipping non-registry sources", () => {
    const before = JSON.stringify({
      dependencies: { react: "^18.0.0" },
      devDependencies: { vitest: "^2" },
    });
    const after = JSON.stringify({
      dependencies: { react: "^18.3.0", zod: "3.23.8", left: "npm:left-pad@1.3.0" },
      devDependencies: { vitest: "^2", local: "file:../local", gh: "user/repo", ws: "workspace:*" },
      peerDependencies: { "@types/node": "^22" },
    });
    expect(addedDependencies(before, after)).toEqual([
      { name: "zod", range: "3.23.8", target: "zod", version: "3.23.8" },
      { name: "left", range: "npm:left-pad@1.3.0", target: "left-pad", version: "1.3.0" },
      { name: "local", range: "file:../local", target: null, version: null },
      { name: "gh", range: "user/repo", target: null, version: null },
      { name: "ws", range: "workspace:*", target: null, version: null },
      { name: "@types/node", range: "^22", target: "@types/node", version: null },
    ]);
    expect(addedDependencies(null, JSON.stringify({ dependencies: { zod: "^3" } }))).toHaveLength(
      1,
    );
    expect(() => addedDependencies(null, "not json")).toThrow();
    expect(() => addedDependencies("[]", "{}")).toThrow();
  });

  it("AC-014-05 attack: an existing dependency re-pointed to another package or to git is listed; a version bump is not", () => {
    const before = JSON.stringify({
      dependencies: { lodash: "^4.17.21", ui: "^1.0.0", zod: "^3.22.0" },
    });
    const after = JSON.stringify({
      dependencies: { lodash: "npm:lodash-evil@1.0.0", ui: "github:evil/ui", zod: "^3.23.0" },
    });
    expect(addedDependencies(before, after).map((d) => [d.name, d.target])).toEqual([
      ["lodash", "lodash-evil"],
      ["ui", null],
    ]);
  });
});
