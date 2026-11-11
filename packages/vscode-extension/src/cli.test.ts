import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Allowed, findCodeceipt, repoRootOf, runCodeceipt, safePath } from "./cli";

// Roadmap Phase 11: the extension runs only the installed codeceipt, with fixed arguments.
const tmp = (name: string) => realpathSync(mkdtempSync(join(tmpdir(), name)));

function script(folder: string, body: string, name = "codeceipt") {
  mkdirSync(folder, { recursive: true });
  const path = join(folder, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("finding the installed codeceipt (roadmap Phase 11)", () => {
  it("PH11-02 prefers the native install folder, then absolute PATH folders", () => {
    const home = tmp("cc-ext-home-");
    const other = tmp("cc-ext-bin-");
    const onPath = script(other, "exit 0");
    expect(findCodeceipt({ PATH: other }, home, "linux", [])).toBe(onPath);
    const native = script(join(home, ".local", "bin"), "exit 0");
    expect(findCodeceipt({ PATH: other }, home, "linux", [])).toBe(native);
    expect(findCodeceipt({ PATH: "" }, tmp("cc-ext-empty-"), "linux", [])).toBeNull();
  });

  it("PH11-03 attack: a codeceipt inside the opened folder is never used", () => {
    const home = tmp("cc-ext-home-");
    const repo = tmp("cc-ext-repo-");
    script(join(repo, "node_modules", ".bin"), "exit 0");
    script(repo, "exit 0");
    const path = [join(repo, "node_modules", ".bin"), repo].join(delimiter);
    expect(findCodeceipt({ PATH: path }, home, "linux", [repo])).toBeNull();
    // Letter case does not get around it.
    expect(findCodeceipt({ PATH: path }, home, "linux", [repo.toUpperCase()])).toBeNull();
  });

  it("PH11-04 attack: relative PATH entries and links into the opened folder are skipped", () => {
    const home = tmp("cc-ext-home-");
    const repo = tmp("cc-ext-repo-");
    const outside = tmp("cc-ext-out-");
    const planted = script(join(repo, "tools"), "exit 0");
    symlinkSync(planted, join(outside, "codeceipt"));
    const path = [".", "node_modules/.bin", "", outside].join(delimiter);
    expect(findCodeceipt({ PATH: path }, home, "linux", [repo])).toBeNull();
    // A home folder that is itself the opened folder gives no install to trust.
    script(join(repo, ".local", "bin"), "exit 0");
    expect(findCodeceipt({ PATH: "" }, repo, "linux", [repo])).toBeNull();
  });

  it("PH11-05 Windows: only codeceipt.exe counts (no .cmd or .bat, which need a shell)", () => {
    const seen: string[] = [];
    const probe = {
      exists: (p: string) => {
        seen.push(p);
        return false;
      },
      present: () => false,
      real: (p: string) => p,
    };
    findCodeceipt({ Path: "C:\\abs\\bin" }, "C:\\Users\\u", "win32", [], probe);
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) expect(p.endsWith("codeceipt.exe")).toBe(true);
  });
});

describe("running codeceipt (roadmap Phase 11)", () => {
  it("PH11-06 runs the fixed arguments in the folder and reads the JSON answer", async () => {
    const bin = script(tmp("cc-ext-bin-"), 'printf \'{"args":"%s","cwd":"%s"}\\n\' "$*" "$(pwd)"');
    const cwd = tmp("cc-ext-cwd-");
    expect(await runCodeceipt(bin, ["status", "--json"], cwd)).toEqual({
      ok: true,
      json: { args: "status --json", cwd },
    });
  });

  it("PH11-07 attack: any other argument list is refused without running anything", async () => {
    const dir = tmp("cc-ext-bin-");
    const bin = script(dir, `touch ${join(dir, "ran")}; echo '{}'`);
    for (const args of [["logout"], ["status", "--json", "--write"], ["export", "--write"], []]) {
      expect(await runCodeceipt(bin, args as unknown as Allowed, dir)).toEqual({
        ok: false,
        reason: "failed",
      });
    }
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(dir, "ran"))).toBe(false);
  });

  it("PH11-08 a failing command, text that is not JSON and too much output never throw", async () => {
    const dir = tmp("cc-ext-bin-");
    expect(await runCodeceipt(script(dir, "exit 1", "a"), ["last", "--json"], dir)).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(await runCodeceipt(script(dir, "echo hello", "b"), ["last", "--json"], dir)).toEqual({
      ok: false,
      reason: "bad_output",
    });
    const big = script(dir, "head -c 400000 /dev/zero | tr '\\0' 'a'", "c");
    expect(await runCodeceipt(big, ["last", "--json"], dir)).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(await runCodeceipt(join(dir, "missing"), ["last", "--json"], dir)).toEqual({
      ok: false,
      reason: "failed",
    });
  });
});

describe("security review fixes (roadmap Phase 11)", () => {
  it("PH11-17 attack: a codeceipt elsewhere in the repository of an opened subfolder is never used", () => {
    const home = tmp("cc-ext-home-");
    const repo = tmp("cc-ext-repo-");
    mkdirSync(join(repo, ".git"));
    const app = join(repo, "packages", "app");
    mkdirSync(app, { recursive: true });
    script(join(repo, "node_modules", ".bin"), "exit 0");
    expect(repoRootOf(app)).toBe(repo);
    expect(
      findCodeceipt({ PATH: join(repo, "node_modules", ".bin") }, home, "linux", [app]),
    ).toBeNull();
  });

  it("PH11-18 attack: the command's own PATH has no relative folder and none inside the project", async () => {
    const repo = tmp("cc-ext-repo-");
    mkdirSync(join(repo, ".git"));
    const app = join(repo, "app");
    mkdirSync(app);
    const outside = tmp("cc-ext-out-");
    const linked = tmp("cc-ext-link-");
    symlinkSync(join(repo, "tools"), join(linked, "into-repo"));
    mkdirSync(join(repo, "tools"));
    const path = [
      ".",
      "node_modules/.bin",
      repo,
      join(repo, "tools"),
      join(linked, "into-repo"),
      outside,
      "/usr/bin",
    ];
    expect(safePath({ PATH: path.join(delimiter) }, "linux", [app])).toBe(
      [outside, "/usr/bin"].join(delimiter),
    );
    // The command really gets that PATH, not the editor's.
    const bin = script(tmp("cc-ext-bin-"), 'printf \'{"path":"%s"}\\n\' "$PATH"');
    expect(await runCodeceipt(bin, ["status", "--json"], app, "/usr/bin")).toEqual({
      ok: true,
      json: { path: "/usr/bin" },
    });
  });

  it("PH11-19 attack: on Windows a PATH folder without a drive letter is not searched", () => {
    const seen: string[] = [];
    const probe = {
      exists: (p: string) => {
        seen.push(p);
        return false;
      },
      present: () => false,
      real: (p: string) => p,
    };
    findCodeceipt({ Path: "\\tools;tools;C:\\bin" }, "C:\\Users\\u", "win32", [], probe);
    expect(seen.some((p) => p.includes("bin"))).toBe(true);
    for (const p of seen) expect(p.startsWith("C:")).toBe(true);
    expect(safePath({ Path: "\\tools;.;C:\\bin" }, "win32", [], probe)).toBe("C:\\bin");
  });
});
