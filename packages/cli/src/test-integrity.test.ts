import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeConfig } from "./config";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// Skip/focus markers in fixtures are joined at runtime so the kit's skip guard does not read them as skipped tests.
const D = ".";

const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");
const SECRET_LINE = "expect(chargeCard(VISA_TEST_NUMBER)).toBe(true);";

function fakeServer() {
  const receipts: Record<string, unknown>[] = [];
  const bodies: string[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (init?.body) bodies.push(String(init.body));
    if (path.endsWith("/open-items")) {
      return Response.json({
        ok: true,
        requests: [
          {
            id: "req-1",
            text: "Fix checkout",
            items: [{ text: "Charge the card", status: "open" }],
          },
        ],
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

function repo() {
  const home = mkdtempSync(join(tmpdir(), "pb-ti-home-"));
  const dir = mkdtempSync(join(tmpdir(), "pb-ti-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: dir,
    });
  git("init", "-q");
  mkdirSync(join(dir, "src"));
  writeFileSync(
    join(dir, "src/pay.test.ts"),
    [
      'describe("checkout", () => {',
      '  it("charges the card", () => {',
      `    ${SECRET_LINE}`,
      "  });",
      '  it("refuses an expired card", () => {',
      "    expect(chargeCard(EXPIRED)).toBe(false);",
      "  });",
      "});",
    ].join("\n"),
  );
  writeFileSync(join(dir, "report.json"), JSON.stringify({ numPassedTests: 42 }));
  git("add", ".");
  git("commit", "-q", "-m", "base");
  linkRepo(dir, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  return { home, dir, git };
}

describe("FEAT-018 the session-end hook checks test integrity on this machine", () => {
  it("AC-018-05 the receipt gets the flags (file and test names only) and the passing-test count before and after", async () => {
    const s = fakeServer();
    const r = repo();
    const run = (event: string) =>
      main(["hook", event, "--agent", "claude"], {
        fetch: s.fetchImpl,
        env: { XDG_CONFIG_HOME: join(r.home, ".config"), CODECEIPT_TEST_REPORT: "report.json" },
        cwd: r.dir,
        homedir: r.home,
        platform: "linux",
        stdout: () => {},
        stderr: () => {},
        readStdin: async () => JSON.stringify({ session_id: "s1", cwd: r.dir }),
      });
    await run("session-start");
    // The agent removes the charging test and skips the other one, then fewer tests pass.
    writeFileSync(
      join(r.dir, "src/pay.test.ts"),
      [
        'describe("checkout", () => {',
        `  it${D}skip("refuses an expired card", () => {`,
        "    expect(chargeCard(EXPIRED)).toBe(false);",
        "  });",
        "});",
      ].join("\n"),
    );
    writeFileSync(join(r.dir, "report.json"), JSON.stringify({ numPassedTests: 40 }));
    await run("session-end");
    expect(s.receipts[0]?.testIntegrity).toEqual({
      flags: [
        { kind: "deleted_tests", file: "src/pay.test.ts", names: ["charges the card"], count: 1 },
        {
          kind: "skipped_tests",
          file: "src/pay.test.ts",
          names: ["skip: refuses an expired card"],
          count: 1,
        },
        { kind: "removed_assertions", file: "src/pay.test.ts", names: [], count: 1 },
      ],
      passingBefore: 42,
      passingAfter: 40,
    });
    // No source line leaves the machine.
    expect(s.bodies.join("\n")).not.toContain("chargeCard");
  });

  it("AC-018-01 a deleted test file is flagged with its test names; no report means no counts", async () => {
    const s = fakeServer();
    const r = repo();
    const run = (event: string) =>
      main(["hook", event, "--agent", "claude"], {
        fetch: s.fetchImpl,
        env: { XDG_CONFIG_HOME: join(r.home, ".config") },
        cwd: r.dir,
        homedir: r.home,
        platform: "linux",
        stdout: () => {},
        stderr: () => {},
        readStdin: async () => JSON.stringify({ session_id: "s2", cwd: r.dir }),
      });
    await run("session-start");
    rmSync(join(r.dir, "src/pay.test.ts"));
    await run("session-end");
    expect(s.receipts[0]?.testIntegrity).toEqual({
      flags: [
        {
          kind: "deleted_test_file",
          file: "src/pay.test.ts",
          names: ["checkout", "charges the card", "refuses an expired card"],
          count: 3,
        },
      ],
      passingBefore: null,
      passingAfter: null,
    });
  });
});
