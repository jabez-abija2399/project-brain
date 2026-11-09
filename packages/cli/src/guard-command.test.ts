import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPath } from "./config";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// Roadmap Phase 5: `codeceipt guard` on a real git repo. Hidden characters are written as \u escapes and fake secrets
// are built at run time.
const RLO = "\u202e";
// A skipped test inside a fixture, built at run time so the kit's diff check does not read it as one of ours.
const SKIPPED = ["it", "skip"].join(".");
const fakeKey = () => ["sk", "_live_", "4eC39HqLyjWDarjtT1zdp7dc"].join("");
const PROJECT = "11111111-2222-3333-4444-555555555555";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "cc-guard-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: dir,
    }).toString();
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "src/math.test.ts"),
    'it("adds", () => { expect(1 + 1).toBe(2); });\nit("subtracts", () => { expect(1 - 1).toBe(0); });\n',
  );
  writeFileSync(join(dir, "src/app.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { react: "^18" } }));
  git("add", ".");
  git("commit", "-q", "-m", "base");
  return { dir, git };
}

function cli(home: string, fetchImpl?: CliDeps["fetch"]) {
  const out: string[] = [];
  const run = async (cwd: string, argv: string[]) => {
    out.length = 0;
    const err: string[] = [];
    const code = await main(argv, {
      fetch:
        fetchImpl ??
        (async () => {
          throw new Error("offline");
        }),
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => "",
    });
    return { code, text: out.join("\n"), err: err.join("\n") };
  };
  return { out, run };
}

describe("codeceipt guard (roadmap Phase 5)", () => {
  it("PH5-12 --staged: weakened tests, a new secret and a hidden character fail in strict mode, with fixes", async () => {
    const { dir, git } = repo();
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    writeFileSync(
      join(dir, "src/math.test.ts"),
      `${SKIPPED}("adds", () => { expect(1 + 1).toBe(2); });\n`,
    );
    writeFileSync(
      join(dir, "src/app.ts"),
      `export const a = 1;\nexport const k = "${fakeKey()}";\nconst s = "${RLO}";\n`,
    );
    git("add", ".");
    const { code, text } = await cli(home).run(dir, ["guard", "--staged"]);
    expect(code).toBe(1);
    expect(text).toContain("src/math.test.ts: 1 test(s) were newly skipped or focused");
    expect(text).toContain("src/app.ts:2: A secret");
    expect(text).toContain("src/app.ts:3: This line has a text-direction control character");
    expect(text).toContain("Fix:");
    expect(text).toContain("Blueprint boundaries were not checked");
    expect(text).not.toContain(fakeKey());
    expect(text).not.toContain(RLO);
  });

  it("PH5-13 gentle mode reports without failing; off checks nothing; a clean change passes", async () => {
    const { dir, git } = repo();
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const { run } = cli(home);
    writeFileSync(join(dir, "src/app.ts"), `export const a = "${RLO}";\n`);
    git("add", ".");
    expect((await run(dir, ["guard", "--staged", "--mode", "gentle"])).code).toBe(0);
    expect((await run(dir, ["config", "guard", "off"])).code).toBe(0);
    const off = await run(dir, ["guard", "--staged"]);
    expect(off.code).toBe(0);
    expect(off.text).toContain("Codeceipt Guard is off");
    expect((await run(dir, ["config", "guard", "strict"])).code).toBe(0);
    writeFileSync(join(dir, "src/app.ts"), "export const a = 2;\n");
    git("add", ".");
    const clean = await run(dir, ["guard", "--staged"]);
    expect(clean.code).toBe(0);
    expect(clean.text).toContain(
      "Codeceipt Guard: no problems in 1 changed file (staged changes).",
    );
  });

  it("PH5-14 the Blueprint's boundaries are read from the server and kept for offline use", async () => {
    const { dir, git } = repo();
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    linkRepo(dir, configPath({ XDG_CONFIG_HOME: join(home, ".config") }, "linux", home), {
      apiUrl: "https://codeceipt.example",
      projectId: PROJECT,
      token: ["pb", "_", "testtoken123"].join(""),
    });
    const seen: string[] = [];
    const online = cli(home, async (url) => {
      seen.push(url);
      return new Response(
        JSON.stringify({
          ok: true,
          ready: true,
          boundaries: [
            { kind: "protected_path", pattern: "supabase/migrations/**" },
            { kind: "disallowed_dependency", pattern: "lodash" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    mkdirSync(join(dir, "supabase/migrations"), { recursive: true });
    writeFileSync(join(dir, "supabase/migrations/02.sql"), "select 1;\n");
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { react: "^18", lodash: "^4" } }),
    );
    git("add", ".");
    const first = await online.run(dir, ["guard", "--staged", "--json"]);
    expect(seen).toEqual([`https://codeceipt.example/api/hooks/${PROJECT}/boundaries`]);
    const rules = (JSON.parse(first.text) as { findings: { rule: string }[] }).findings.map(
      (f) => f.rule,
    );
    expect(rules).toEqual(["protected_path", "disallowed_dependency"]);
    const offline = await cli(home).run(dir, ["guard", "--staged"]);
    expect(offline.code).toBe(1);
    expect(offline.text).toContain("This path is protected by the owner (supabase/migrations/**)");
    expect(offline.text).not.toContain("were not checked");
  });

  it("PH5-15 --ci compares the branch with its base", async () => {
    const { dir, git } = repo();
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    git("checkout", "-q", "-b", "feature");
    writeFileSync(join(dir, "src/math.test.ts"), 'it("adds", () => { expect(1 + 1).toBe(2); });\n');
    git("commit", "-q", "-am", "drop a test");
    const res = await cli(home).run(dir, ["guard", "--ci", "--base", "main"]);
    expect(res.code).toBe(1);
    expect(res.text).toContain("1 test(s) were removed");
    expect(res.text).toContain("(changes on this branch)");
    expect((await cli(home).run(dir, ["guard", "--ci", "--base", "--upload-pack=x"])).code).toBe(2);
  });

  it("PH5-16 --install-hook writes a pre-commit hook only when there is none", async () => {
    const { dir } = repo();
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const { run } = cli(home);
    const hook = join(dir, ".git/hooks/pre-commit");
    const first = await run(dir, ["guard", "--install-hook"]);
    expect(first.code).toBe(0);
    expect(readFileSync(hook, "utf8")).toContain("guard --staged");
    expect(statSync(hook).mode & 0o111).not.toBe(0);
    expect((await run(dir, ["guard", "--install-hook"])).text).toContain(
      "already checks every commit",
    );
    writeFileSync(hook, "#!/bin/sh\necho mine\n");
    const other = await run(dir, ["guard", "--install-hook"]);
    expect(other.text).toContain("already has a pre-commit hook");
    expect(readFileSync(hook, "utf8")).toBe("#!/bin/sh\necho mine\n");
    expect(existsSync(hook)).toBe(true);
  });

  it("PH5-17 a 100-file change is checked in under 2 seconds", async () => {
    const { dir, git } = repo();
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(dir, `src/f${i}.ts`), `export const v${i} = ${i};\n`.repeat(50));
    }
    git("add", ".");
    const started = performance.now();
    const res = await cli(home).run(dir, ["guard", "--staged"]);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(res.code).toBe(0);
  });
});
