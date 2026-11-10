import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkKey } from "./check-run";
import { configPath, writeSettings } from "./config";
import { type CliDeps, main } from "./index";
import { withTestFiles } from "./prove-command";
import { linkRepo } from "./test-support";

// Roadmap Phase 5d: `codeceipt prove` runs only the tests for the current change, with the repo's own check command.
// A fake `jest` on PATH records which files it was given and prints a jest-like summary.
const bin = mkdtempSync(join(tmpdir(), "cc-prove-bin-"));
const savedPath = process.env.PATH;
beforeAll(() => {
  writeFileSync(
    join(bin, "jest"),
    [
      "#!/bin/sh",
      'echo "$@" > "$PWD/.jest-args"',
      'case "$*" in *broken*) echo "FAIL src/broken.test.ts > adds"; echo "Tests:  1 failed, 2 passed, 3 total"; exit 1;; esac',
      'echo "Tests:  3 passed, 3 total"',
    ].join("\n"),
  );
  chmodSync(join(bin, "jest"), 0o755);
  process.env.PATH = `${bin}:${savedPath}`;
});
afterAll(() => {
  process.env.PATH = savedPath;
});

const PROJECT = "11111111-2222-3333-4444-555555555555";

function setup(command = "jest") {
  const repo = mkdtempSync(join(tmpdir(), "cc-prove-"));
  const home = mkdtempSync(join(tmpdir(), "cc-home-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  mkdirSync(join(repo, "src"), { recursive: true });
  for (const f of [
    "src/cart.ts",
    "src/cart.test.ts",
    "src/other.ts",
    "src/other.test.ts",
    "src/linked.test.ts",
  ]) {
    writeFileSync(join(repo, f), "export {};\n");
  }
  git("add", ".");
  git("commit", "-q", "-m", "base");
  const configFile = configPath({ XDG_CONFIG_HOME: join(home, ".config") }, "linux", home);
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repo })
    .toString()
    .trim();
  writeSettings(configFile, { checks: { [checkKey(root)]: { command, timeoutSec: 30 } } });
  const run = async (argv: string[], fetchImpl?: CliDeps["fetch"]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(argv, {
      fetch:
        fetchImpl ??
        (async () => {
          throw new Error("offline");
        }),
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => "",
    });
    return { code, text: out.join("\n"), err: err.join("\n") };
  };
  const args = () => readFileSync(join(repo, ".jest-args"), "utf8").trim();
  return { repo, home, configFile, run, args };
}

describe("codeceipt prove (roadmap Phase 5d)", () => {
  it("PH5D-01 only the change's tests run: changed test files and the tests next to changed source files", async () => {
    const t = setup();
    writeFileSync(join(t.repo, "src/cart.ts"), "export const total = 1;\n");
    const res = await t.run(["prove"]);
    expect(res.code).toBe(0);
    expect(t.args()).toBe("src/cart.test.ts");
    expect(res.text).toBe(
      "Codeceipt prove: 1 test file for this change passed (3 passed, 0 failed).",
    );
  });

  it("PH5D-02 a failure shows the counts and failing test names, and the command fails", async () => {
    const t = setup();
    writeFileSync(join(t.repo, "src/broken.test.ts"), "export {};\n");
    const res = await t.run(["prove", "--json"]);
    expect(res.code).toBe(1);
    expect(JSON.parse(res.text)).toEqual({
      status: "failed",
      tests: 1,
      passed: 2,
      failed: 1,
      failing: ["src/broken.test.ts > adds"],
    });
  });

  it("PH5D-03 --for adds the tests the owner linked to the request's feature", async () => {
    const t = setup();
    linkRepo(t.repo, t.configFile, {
      apiUrl: "https://codeceipt.example",
      projectId: PROJECT,
      token: ["pb", "_", "testtoken123"].join(""),
    });
    const res = await t.run(["prove", "--for", "coupons in checkout"], async () =>
      Response.json({ ok: true, feature: "Checkout", note: "x", tests: ["src/linked.test.ts"] }),
    );
    expect(res.code).toBe(0);
    expect(t.args()).toBe("src/linked.test.ts");
  });

  it("PH5D-04 nothing linked runs nothing; no check command or one that takes no files is a plain message", async () => {
    const t = setup();
    expect((await t.run(["prove"])).text).toBe(
      "Codeceipt prove: no tests are linked to this change, so nothing was run.",
    );
    const custom = setup("make test");
    writeFileSync(join(custom.repo, "src/cart.ts"), "export const total = 2;\n");
    const res = await custom.run(["prove"]);
    expect(res.code).toBe(2);
    expect(res.err).toContain("does not take test files");
  });

  it("PH5D-05 attack: test paths with shell characters from the server or the repo are never given to the command", async () => {
    expect(withTestFiles("jest", ["a.test.ts"], "linux")).toBe("jest 'a.test.ts'");
    expect(withTestFiles("npm test", ["a.test.ts"], "linux")).toBe("npm test -- 'a.test.ts'");
    expect(withTestFiles("jest; rm -rf ~", ["a.test.ts"], "linux")).toBeNull();
    const t = setup();
    linkRepo(t.repo, t.configFile, {
      apiUrl: "https://codeceipt.example",
      projectId: PROJECT,
      token: ["pb", "_", "testtoken123"].join(""),
    });
    const res = await t.run(["prove", "--for", "checkout"], async () =>
      Response.json({
        ok: true,
        tests: [
          "src/x.test.ts; touch pwned",
          "--config=evil.js",
          "../outside.test.ts",
          "src/linked.test.ts",
        ],
      }),
    );
    expect(res.code).toBe(0);
    expect(t.args()).toBe("src/linked.test.ts");
  });
});
