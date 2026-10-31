import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// D-025, from the edutech test: files the user had already changed before the session are not the agent's changes,
// and the receipt's judge gets a code-free summary of each change. The token is built at runtime.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");
const SECRET = ["sk_", "live_", "4eC39Hq", "LyjWDarj", "Ab12"].join("");

type Receipt = {
  changedFiles: string[];
  preExistingFiles?: string[];
  snapshot?: string;
  changeSummaries?: { path: string }[];
  secretFindings?: { file: string }[];
  testIntegrity?: { flags: { file: string }[] };
};

function setup() {
  const home = mkdtempSync(join(tmpdir(), "cc-snap-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-snap-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  const write = (path: string, text: string) => {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  git("init", "-q");
  write("prisma/schema.prisma", "model Course {\n  id Int @id\n}\n");
  write("src/lib/offline/sync.ts", "export function sync() {\n  return 1;\n}\n");
  write("src/app/page.tsx", "export default function Home() {\n  return <main />;\n}\n");
  write("src/app/page.test.tsx", 'it("renders", () => {});\nit("links", () => {});\n');
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
      const req = [{ id: "req-1", text: "Add a comment at the top of the main page", items: [] }];
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
  // The user's own work in progress before the session: two modified files, an untracked dump with a secret, and a
  // test file with one test removed.
  const dirty = () => {
    write("prisma/schema.prisma", "model Course {\n  id Int @id\n  title String\n}\n");
    write("src/lib/offline/sync.ts", "export function sync() {\n  return 2;\n}\n");
    write("db_dump.json", `{"key": "${SECRET}"}\n`);
    write("src/app/page.test.tsx", 'it("renders", () => {});\n');
  };
  const agentEdit = () =>
    write(
      "src/app/page.tsx",
      "// Main page: the course list\nexport default function Home() {\n  return <main />;\n}\n",
    );
  return { repo, write, dirty, agentEdit, receipts, err, run, git };
}

describe("D-025 files changed before the session are not the agent's changes", () => {
  it("untouched pre-existing modified and untracked files are left out of the receipt, the secret scan and the test checks", async () => {
    const t = setup();
    t.dirty();
    await t.run("session-start");
    t.agentEdit();
    expect(await t.run("session-end")).toBe(0);
    const [r] = t.receipts;
    expect(r?.changedFiles).toEqual(["src/app/page.tsx"]);
    expect(r?.preExistingFiles ?? []).toEqual([]);
    expect(r?.snapshot).toBeUndefined();
    expect(r?.secretFindings ?? []).toEqual([]);
    expect(r?.testIntegrity?.flags ?? []).toEqual([]);
    expect(t.err.join("\n")).toContain("Codeceipt receipt: 1 file changed");
  });

  it("a pre-existing changed file the agent edits further counts, marked as already modified before the session", async () => {
    const t = setup();
    t.dirty();
    await t.run("session-start");
    t.agentEdit();
    t.write("src/lib/offline/sync.ts", "export function sync() {\n  return 3;\n}\n");
    await t.run("session-end");
    const [r] = t.receipts;
    expect([...(r?.changedFiles ?? [])].sort()).toEqual([
      "src/app/page.tsx",
      "src/lib/offline/sync.ts",
    ]);
    expect(r?.preExistingFiles).toEqual(["src/lib/offline/sync.ts"]);
  });

  it("with no snapshot (no session-start), every changed file counts and the receipt and summary say so", async () => {
    const t = setup();
    t.dirty();
    t.agentEdit();
    await t.run("session-end");
    const [r] = t.receipts;
    expect([...(r?.changedFiles ?? [])].sort()).toEqual(
      [
        "db_dump.json",
        "prisma/schema.prisma",
        "src/app/page.test.tsx",
        "src/app/page.tsx",
        "src/lib/offline/sync.ts",
      ].sort(),
    );
    expect(r?.snapshot).toBe("missing");
    expect(t.err).toContain(
      "Codeceipt: No snapshot from the start of this session, so files already changed before it may be counted as this session's changes.",
    );
  });

  it("attack: a tampered snapshot in the state file is ignored (fallback with the notice), never trusted", async () => {
    const t = setup();
    t.dirty();
    await t.run("session-start");
    t.agentEdit();
    const dir = join(t.repo, ".git", "projectbrain");
    const [stateName] = readdirSync(dir);
    const state = JSON.parse(readFileSync(join(dir, stateName as string), "utf8"));
    state.snapshot = { "src/app/page.tsx": "not-a-hash", "../../etc/passwd": "deleted" };
    writeFileSync(join(dir, stateName as string), JSON.stringify(state));
    await t.run("session-end");
    expect(t.receipts[0]?.snapshot).toBe("missing");
    expect(t.receipts[0]?.changedFiles).toContain("src/app/page.tsx");
  });
});

describe("D-025 code-free change summaries", () => {
  it("the edutech case: the comment at the top of the main page is summarized; no source text leaves the machine", async () => {
    const t = setup();
    await t.run("session-start");
    t.agentEdit();
    await t.run("session-end");
    const [r] = t.receipts;
    expect(r?.changeSummaries).toEqual([
      {
        path: "src/app/page.tsx",
        added: 1,
        removed: 0,
        comment_only: true,
        imports_changed: false,
        symbols_added: [],
        symbols_removed: [],
        symbols_changed: [],
        where: ["top of file"],
      },
    ]);
    const sent = JSON.stringify(t.receipts);
    expect(sent).not.toContain("course list");
    expect(sent).not.toContain("<main />");
  });

  it("attack: a secret in a new file's symbol name is masked in the summary", async () => {
    const t = setup();
    await t.run("session-start");
    t.write("src/config.ts", `export const ${SECRET} = 1;\n`);
    await t.run("session-end");
    expect(JSON.stringify(t.receipts)).not.toContain(SECRET);
    expect(t.receipts[0]?.changeSummaries?.map((s) => s.path)).toEqual(["src/config.ts"]);
  });
});

describe("D-025 security pass: snapshot and summaries", () => {
  it("attack: a huge untracked file stops the snapshot quickly (no snapshot) instead of hashing gigabytes", async () => {
    const { takeSnapshot } = await import("./session-snapshot");
    const { runGit } = await import("./scan-secrets");
    const t = setup();
    execFileSync("truncate", ["-s", "2G", join(t.repo, "dataset.bin")]);
    const started = Date.now();
    expect(await takeSnapshot(runGit, t.repo)).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("a binary or large file still gets a summary (no counts), so it never removes the evidence for missed", async () => {
    const t = setup();
    await t.run("session-start");
    t.agentEdit();
    t.write("public/logo.png", "\u0089PNG\u0000\u0000binary");
    t.write("public/big.json", `"${"x".repeat(1_100_000)}"`);
    await t.run("session-end");
    const byPath = Object.fromEntries(
      (t.receipts[0]?.changeSummaries ?? []).map((s) => [s.path, s]),
    );
    expect(byPath["public/logo.png"]).toMatchObject({
      added: 0,
      removed: 0,
      where: ["binary file"],
    });
    expect(byPath["public/big.json"]).toMatchObject({
      added: 0,
      removed: 0,
      where: ["large file"],
    });
  });
});
