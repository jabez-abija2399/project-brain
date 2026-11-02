import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// M (real-test): a test check counts only what this session added. A skip that was already in the working tree
// before the session start is reported apart as "already modified before this session", never counted.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");
// Built at runtime so the kit's skip guard does not take the fixture text for a skipped test.
const SKIP = ["it", "skip"].join(".");
const TEST_FILE = "src/lib/permissions.test.ts";
const BASE_TEST = [
  'import { expect, it } from "vitest";',
  'it("allows admins", () => {',
  "  expect(1).toBe(1);",
  "});",
  'it("denies guests", () => {',
  "  expect(2).toBe(2);",
  "});",
  "",
].join("\n");

type Receipt = {
  changedFiles: string[];
  preExistingFiles?: string[];
  testIntegrity?: { flags: { kind: string; file: string; names: string[]; count: number }[] };
};

function setup() {
  const home = mkdtempSync(join(tmpdir(), "cc-integ-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-integ-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  git("init", "-q");
  write(TEST_FILE, BASE_TEST);
  write("src/app/page.tsx", "export default function Home() {\n  return <main />;\n}\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const receipts: Receipt[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/open-items")) {
      const req = [{ id: "req-1", text: "Add .skip to the second test", items: [] }];
      return Response.json({ ok: true, requests: req, session_requests: req });
    }
    const body = JSON.parse(String(init?.body));
    const { name, arguments: args } = body.params;
    if (name === "generate_receipt") receipts.push(args);
    const text =
      name === "generate_receipt"
        ? JSON.stringify({ receipt_id: "rc-1", items: [], outside_scope: [], not_verified: [] })
        : "{}";
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: { content: [{ type: "text", text }] },
    });
  };
  const err: string[] = [];
  const run = (event: string) => {
    err.length = 0;
    return main(["hook", event, "--agent", "claude"], {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: () => {},
      stderr: (l) => err.push(l),
      readStdin: async () => JSON.stringify({ session_id: "s1", cwd: repo }),
    });
  };
  return { repo, write, receipts, err, run, git };
}

describe("M: test checks count only this session's skips", () => {
  it("a .skip added before the session snapshot and one added during the session: exactly one skip is counted", async () => {
    const t = setup();
    // The user's own skip, already in the working tree before the session starts.
    t.write(TEST_FILE, BASE_TEST.replace('it("allows admins"', `${SKIP}("allows admins"`));
    await t.run("session-start");
    // The agent's skip, during the session.
    t.write(
      TEST_FILE,
      BASE_TEST.replace('it("allows admins"', `${SKIP}("allows admins"`).replace(
        'it("denies guests"',
        `${SKIP}("denies guests"`,
      ),
    );
    expect(await t.run("session-end")).toBe(0);
    const [r] = t.receipts;
    expect(r?.preExistingFiles).toEqual([TEST_FILE]);
    const skips = (r?.testIntegrity?.flags ?? []).filter((f) => f.kind === "skipped_tests");
    expect(skips).toHaveLength(1);
    expect(skips[0]?.file).toBe(TEST_FILE);
    expect(skips[0]?.count).toBe(1);
    expect(skips[0]?.names).toEqual(["skip: denies guests"]);
  });

  it("the pre-session skip is reported apart as already modified before this session, not counted", async () => {
    const t = setup();
    t.write(TEST_FILE, BASE_TEST.replace('it("allows admins"', `${SKIP}("allows admins"`));
    await t.run("session-start");
    t.write(
      TEST_FILE,
      BASE_TEST.replace('it("allows admins"', `${SKIP}("allows admins"`).replace(
        'it("denies guests"',
        `${SKIP}("denies guests"`,
      ),
    );
    await t.run("session-end");
    expect(t.err.join("\n")).toContain("already modified before this session");
    expect(t.err.join("\n")).toContain(TEST_FILE);
    expect(t.err.join("\n")).toContain("1 skipped test");
  });

  it("a pre-session skip alone, with the agent editing another file: no skip is counted for the session", async () => {
    const t = setup();
    t.write(TEST_FILE, BASE_TEST.replace('it("allows admins"', `${SKIP}("allows admins"`));
    await t.run("session-start");
    t.write(
      "src/app/page.tsx",
      "// Main page\nexport default function Home() {\n  return <main />;\n}\n",
    );
    await t.run("session-end");
    const [r] = t.receipts;
    expect(r?.changedFiles).toEqual(["src/app/page.tsx"]);
    expect(r?.testIntegrity?.flags ?? []).toEqual([]);
  });
});
