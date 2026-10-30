// FEAT-018 /security pass (CLI): evasions and leaks around the session-end hook's local integrity check. Temp git repos
// and a fake server through the injected fetch; no network.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeConfig } from "./config";
import { type CliDeps, main } from "./index";
import { passingTests } from "./test-integrity-local";

const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");

type Flag = { kind: string; file: string; names: string[]; count: number };
type Integrity = { flags: Flag[]; passingBefore: number | null; passingAfter: number | null };

function fakeServer() {
  const receipts: Record<string, unknown>[] = [];
  const bodies: string[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (init?.body) bodies.push(String(init.body));
    if (path.endsWith("/open-items")) {
      return Response.json({
        ok: true,
        requests: [{ id: "req-1", text: "Fix checkout", items: [{ text: "Pay", status: "open" }] }],
      });
    }
    const body = JSON.parse(String(init?.body));
    if (body.params.name === "generate_receipt") receipts.push(body.params.arguments);
    const text =
      body.params.name === "generate_receipt" ? JSON.stringify({ receipt_id: "rc-1" }) : "{}";
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: { content: [{ type: "text", text }] },
    });
  };
  return { receipts, bodies, fetchImpl };
}

const PAY_TEST = [
  'describe("checkout", () => {',
  '  it("charges the card", () => {',
  "    expect(chargeCard(VISA)).toBe(true);",
  "  });",
  '  it("refuses an expired card", () => {',
  "    expect(chargeCard(EXPIRED)).toBe(false);",
  "  });",
  "});",
].join("\n");

function repo(files: Record<string, string> = { "src/pay.test.ts": PAY_TEST }) {
  const home = mkdtempSync(join(tmpdir(), "pb-tis-home-"));
  const dir = mkdtempSync(join(tmpdir(), "pb-tis-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: dir,
    });
  git("init", "-q");
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  git("add", ".");
  git("commit", "-q", "-m", "base");
  writeConfig(join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  return { home, dir, git };
}

function runner(
  r: ReturnType<typeof repo>,
  s: ReturnType<typeof fakeServer>,
  env: Record<string, string> = {},
) {
  const stderr: string[] = [];
  const run = (event: string) =>
    main(["hook", event, "--agent", "claude"], {
      fetch: s.fetchImpl,
      env: { XDG_CONFIG_HOME: join(r.home, ".config"), ...env },
      cwd: r.dir,
      homedir: r.home,
      platform: "linux",
      stdout: () => {},
      stderr: (l) => stderr.push(l),
      readStdin: async () => JSON.stringify({ session_id: "sec-1", cwd: r.dir }),
    });
  return { run, stderr };
}

const integrityOf = (s: ReturnType<typeof fakeServer>) =>
  s.receipts[0]?.testIntegrity as Integrity | undefined;

describe("FEAT-018 security: the session-end hook's integrity check (CLI)", () => {
  it("AC-018-04 attack (false alarm): renaming a test file unchanged (git mv) is not flagged as a deleted test file", async () => {
    const s = fakeServer();
    const r = repo();
    const { run } = runner(r, s);
    await run("session-start");
    r.git("mv", "src/pay.test.ts", "src/checkout.test.ts");
    await run("session-end");
    expect(integrityOf(s)?.flags ?? []).toEqual([]);
  }, 30_000);

  it("AC-018-01 attack: renaming a test file and deleting one of its tests in the same change still names the removed test", async () => {
    const s = fakeServer();
    const r = repo();
    const { run } = runner(r, s);
    await run("session-start");
    r.git("mv", "src/pay.test.ts", "src/checkout.test.ts");
    writeFileSync(
      join(r.dir, "src/checkout.test.ts"),
      PAY_TEST.split("\n").slice(0, 4).concat("});").join("\n"),
    );
    await run("session-end");
    const flags = integrityOf(s)?.flags ?? [];
    const flagged = flags.filter(
      (f) => f.kind === "deleted_tests" || f.kind === "deleted_test_file",
    );
    expect(flagged.flatMap((f) => f.names)).toContain("refuses an expired card");
  }, 30_000);

  it("AC-018-01 attack: tests moved to a non-test file, or deleted from __tests__, .test.mts and .spec.cjs files, are flagged", async () => {
    const s = fakeServer();
    const r = repo({
      "src/pay.test.ts": PAY_TEST,
      "src/__tests__/cart.ts": 'it("adds to cart", () => { expect(1).toBe(1); });',
      "src/order.test.mts": 'it("places an order", () => { expect(1).toBe(1); });',
      "src/legacy.spec.cjs": 'it("keeps legacy totals", () => { expect(1).toBe(1); });',
    });
    const { run } = runner(r, s);
    await run("session-start");
    writeFileSync(join(r.dir, "src/pay.helpers.ts"), PAY_TEST);
    for (const f of [
      "src/pay.test.ts",
      "src/__tests__/cart.ts",
      "src/order.test.mts",
      "src/legacy.spec.cjs",
    ])
      rmSync(join(r.dir, f));
    await run("session-end");
    const flags = integrityOf(s)?.flags ?? [];
    expect(flags.map((f) => `${f.kind} ${f.file}`).sort()).toEqual([
      "deleted_test_file src/__tests__/cart.ts",
      "deleted_test_file src/legacy.spec.cjs",
      "deleted_test_file src/order.test.mts",
      "deleted_test_file src/pay.test.ts",
    ]);
    expect(flags.flatMap((f) => f.names)).toEqual(
      expect.arrayContaining([
        "charges the card",
        "adds to cart",
        "places an order",
        "keeps legacy totals",
      ]),
    );
  }, 30_000);

  it("AC-018-01 attack: paths with ':', spaces, a leading '-' and non-ASCII are read from the base commit, not mis-parsed by git show", async () => {
    const odd = [
      "src/a:b.test.ts",
      "src/with space.test.ts",
      "src/-rf.test.ts",
      "src/caf\u00e9.test.ts",
    ];
    const s = fakeServer();
    const r = repo(
      Object.fromEntries(
        odd.map((p, i) => [p, `it("odd case ${i}", () => { expect(${i}).toBe(${i}); });`]),
      ),
    );
    const { run } = runner(r, s);
    await run("session-start");
    for (const p of odd) rmSync(join(r.dir, p));
    await run("session-end");
    const flags = integrityOf(s)?.flags ?? [];
    expect(flags.map((f) => f.file).sort()).toEqual([...odd].sort());
    expect(flags.flatMap((f) => f.names).sort()).toEqual([
      "odd case 0",
      "odd case 1",
      "odd case 2",
      "odd case 3",
    ]);
  }, 30_000);

  it("AC-018-01 attack: a test file replaced by a symlink to a file outside the repo is flagged, and the outside file is never read or sent", async () => {
    const outside = mkdtempSync(join(tmpdir(), "pb-tis-outside-"));
    const outsideFile = join(outside, "private.test.ts");
    writeFileSync(
      outsideFile,
      'it("outside private name", () => { expect(OUTSIDE_SOURCE).toBe(1); });',
    );
    const s = fakeServer();
    const r = repo();
    const { run } = runner(r, s);
    await run("session-start");
    rmSync(join(r.dir, "src/pay.test.ts"));
    symlinkSync(outsideFile, join(r.dir, "src/pay.test.ts"));
    // A new symlinked test file to the same outside file.
    symlinkSync(outsideFile, join(r.dir, "src/extra.test.ts"));
    await run("session-end");
    const flags = integrityOf(s)?.flags ?? [];
    expect(flags.find((f) => f.file === "src/pay.test.ts")?.names).toContain("charges the card");
    const all = s.bodies.join("\n");
    expect(all).not.toContain("outside private name");
    expect(all).not.toContain("OUTSIDE_SOURCE");
  }, 30_000);

  it("AC-018-01 attack: a forged or missing base commit in the state file falls back to HEAD and still flags a deleted test", async () => {
    const s = fakeServer();
    const r = repo();
    const { run } = runner(r, s);
    await run("session-start");
    const stateDir = join(r.dir, ".git", "projectbrain");
    const [state] = readdirSync(stateDir);
    // The agent points the session start at a commit that does not exist.
    writeFileSync(
      join(stateDir, state ?? "x"),
      JSON.stringify({ start: "f".repeat(40), passing: 999 }),
    );
    rmSync(join(r.dir, "src/pay.test.ts"));
    await run("session-end");
    expect(integrityOf(s)?.flags.map((f) => f.kind)).toEqual(["deleted_test_file"]);
  }, 30_000);

  it("AC-018-05 attack: a hostile CODECEIPT_TEST_REPORT (outside the repo, symlinked out, absolute, huge, malformed, negative, float) gives no count", async () => {
    const r = repo();
    const outside = mkdtempSync(join(tmpdir(), "pb-tis-report-"));
    writeFileSync(join(outside, "report.json"), JSON.stringify({ numPassedTests: 7 }));
    symlinkSync(join(outside, "report.json"), join(r.dir, "linked.json"));
    symlinkSync(outside, join(r.dir, "linkdir"));
    writeFileSync(
      join(r.dir, "huge.json"),
      `{"numPassedTests": 5, "pad": "${"x".repeat(6 * 1024 * 1024)}"}`,
    );
    writeFileSync(join(r.dir, "bad.json"), "{ numPassedTests: 5 ");
    writeFileSync(join(r.dir, "neg.json"), JSON.stringify({ numPassedTests: -3 }));
    writeFileSync(join(r.dir, "float.json"), JSON.stringify({ numPassedTests: 4.5 }));
    writeFileSync(join(r.dir, "str.json"), JSON.stringify({ numPassedTests: "12" }));
    writeFileSync(join(r.dir, "null.json"), "null");
    writeFileSync(join(r.dir, "inf.json"), '{"numPassedTests": 1e400}');
    const rel = `../${outside.split("/").pop()}/report.json`;
    for (const p of [
      join(outside, "report.json"),
      rel,
      `./${rel}`,
      `src/../../${outside.split("/").pop()}/report.json`,
      "linked.json",
      "linkdir/report.json",
      "huge.json",
      "bad.json",
      "neg.json",
      "float.json",
      "str.json",
      "null.json",
      "inf.json",
      "missing.json",
      "src",
    ]) {
      expect(await passingTests(r.dir, p), p).toBeNull();
    }
    writeFileSync(join(r.dir, "ok.json"), JSON.stringify({ numPassedTests: 12 }));
    expect(await passingTests(r.dir, "./ok.json")).toBe(12);
  }, 30_000);

  it("AC-018-05 attack: an absurd passing count in the report does not make the server refuse the whole receipt (its flags would be lost)", async () => {
    const s = fakeServer();
    const r = repo({
      "src/pay.test.ts": PAY_TEST,
      "report.json": JSON.stringify({ numPassedTests: 40 }),
    });
    const { run } = runner(r, s, { CODECEIPT_TEST_REPORT: "report.json" });
    await run("session-start");
    rmSync(join(r.dir, "src/pay.test.ts"));
    // The server accepts counts up to 1,000,000 (receipt-integrity.ts); anything above fails validation (400).
    writeFileSync(join(r.dir, "report.json"), JSON.stringify({ numPassedTests: 50_000_000 }));
    await run("session-end");
    const ti = integrityOf(s);
    expect(ti?.flags.map((f) => f.kind)).toEqual(["deleted_test_file"]);
    const after = ti?.passingAfter;
    expect(after === null || (typeof after === "number" && after <= 1_000_000)).toBe(true);
  }, 30_000);

  it("AC-018-01 attack: deleting more test files than the server accepts flags for (50) still yields an acceptable receipt body", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [
        `src/t${i}.test.ts`,
        `it("case ${i}", () => { expect(${i}).toBe(${i}); });`,
      ]),
    );
    const s = fakeServer();
    const r = repo(files);
    const { run } = runner(r, s);
    await run("session-start");
    for (const f of Object.keys(files)) rmSync(join(r.dir, f));
    await run("session-end");
    const ti = integrityOf(s);
    expect(ti?.flags.length).toBeGreaterThan(0);
    // generate_receipt refuses more than 50 flags (MAX_INTEGRITY_FLAGS): the whole receipt, with every flag, is lost.
    expect(ti?.flags.length ?? 0).toBeLessThanOrEqual(50);
  }, 60_000);

  it("AC-018-02 attack: a secret used as a test name is masked before it leaves the machine, and no test source is sent", async () => {
    const key = ["sk", "_live_", "aB3dE5gH7j", "kL9mN0pQ2r"].join("");
    const s = fakeServer();
    const r = repo({
      "src/pay.test.ts": [
        `it("charges with ${key}", () => {`,
        "  expect(chargeCard(VISA)).toBe(true);",
        "});",
        `it(\`renders ${"<Checkout total={sum(items)} />"}\`, () => {`,
        "  expect(render(CHECKOUT_SOURCE)).toBeTruthy();",
        "});",
      ].join("\n"),
    });
    const { run, stderr } = runner(r, s);
    await run("session-start");
    rmSync(join(r.dir, "src/pay.test.ts"));
    await run("session-end");
    const flags = integrityOf(s)?.flags ?? [];
    expect(flags[0]?.kind).toBe("deleted_test_file");
    const all = s.bodies.join("\n") + stderr.join("\n");
    expect(all).not.toContain(key);
    expect(all).toContain(key.slice(0, 4));
    expect(all).not.toContain("CHECKOUT_SOURCE");
    expect(all).not.toContain("chargeCard");
    // The hook's own warning carries counts only.
    expect(stderr.join("\n")).not.toContain("charges with");
  }, 30_000);

  it("AC-018-03 attack: a test-selection change made in package.json (jest key or the test script) is flagged on this machine", async () => {
    const pkg = (jest: string, script: string) =>
      JSON.stringify({ name: "shop", scripts: { test: script }, jest: JSON.parse(jest) }, null, 2);
    const s = fakeServer();
    const r = repo({ "src/pay.test.ts": PAY_TEST, "package.json": pkg("{}", "vitest run") });
    const { run } = runner(r, s);
    await run("session-start");
    writeFileSync(
      join(r.dir, "package.json"),
      pkg('{ "testPathIgnorePatterns": ["/pay/"] }', "vitest run --exclude src/pay.test.ts"),
    );
    await run("session-end");
    expect(integrityOf(s)?.flags.map((f) => `${f.kind} ${f.file}`)).toEqual([
      "test_config_changed package.json",
    ]);
  }, 30_000);

  it("AC-018-05 attack: a state file replaced by a symlink cannot forge the starting passing count", async () => {
    const s = fakeServer();
    const r = repo({
      "src/pay.test.ts": PAY_TEST,
      "report.json": JSON.stringify({ numPassedTests: 10 }),
    });
    const { run } = runner(r, s, { CODECEIPT_TEST_REPORT: "report.json" });
    await run("session-start");
    const stateDir = join(r.dir, ".git", "projectbrain");
    const [state] = readdirSync(stateDir);
    const saved = JSON.parse(readFileSync(join(stateDir, state ?? "x"), "utf8")) as {
      passing: unknown;
    };
    expect(saved.passing).toBe(10);
    // The agent replaces the state file by a symlink to a file it controls claiming a lower starting count.
    const fake = join(mkdtempSync(join(tmpdir(), "pb-tis-state-")), "s.json");
    writeFileSync(fake, JSON.stringify({ start: null, passing: 1 }));
    rmSync(join(stateDir, state ?? "x"));
    symlinkSync(fake, join(stateDir, state ?? "x"));
    writeFileSync(join(r.dir, "report.json"), JSON.stringify({ numPassedTests: 9 }));
    await run("session-end");
    // The symlinked state is ignored: no forged "before" count is reported.
    expect(integrityOf(s)?.passingBefore ?? null).toBeNull();
  }, 30_000);
});
