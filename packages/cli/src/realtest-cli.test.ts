import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { dependenciesOnly, dependencyChanges } from "./dependency-changes";
import { type CliDeps, main } from "./index";
import { attentionLines } from "./last-attention";
import { runGit } from "./scan-secrets";
import { onPath } from "./setup-command";
import { shellHook } from "./templates";
import { linkRepo } from "./test-support";

// Real-test bugs F, I, C and H, plus the macOS/npx and VS Code fixes (2026-11-01), on a real git repo with a fake
// server. The token is built at runtime.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");

type Call = { path: string; tool?: string; args?: Record<string, unknown> };

function setup(opts: { requests?: unknown[]; sessionRequests?: unknown[] } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cc-rt-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-rt-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify(
      {
        name: "app",
        scripts: { build: "secret-build --token=abc" },
        dependencies: { react: "^18.2.0" },
      },
      null,
      2,
    ),
  );
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: "https://brain.test",
    projectId: "proj-1",
    token: TOKEN,
  });
  const calls: Call[] = [];
  let receipts = 0;
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/open-items")) {
      calls.push({ path });
      return Response.json({
        ok: true,
        requests: opts.requests ?? [],
        session_requests: opts.sessionRequests ?? [],
      });
    }
    if (path === "/api/token/whoami") return Response.json({ ok: true, project_id: "proj-1" });
    const body = JSON.parse(String(init?.body));
    const { name, arguments: args } = body.params;
    calls.push({ path, tool: name, args });
    const text =
      name === "generate_receipt"
        ? JSON.stringify({
            receipt_id: `rc-${++receipts}`,
            items: [{ id: "i1", text: "Add a pricing page", status: "missed" }],
            no_changes: (args.changedFiles as string[]).length === 0,
            outside_scope: [],
            not_verified: [],
            findings: [],
            findings_omitted: 0,
            test_integrity: null,
          })
        : "{}";
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: { content: [{ type: "text", text }] },
    });
  };
  const out: string[] = [];
  const err: string[] = [];
  const run = (argv: string[], stdin = JSON.stringify({ session_id: "s1", cwd: repo })) => {
    out.length = 0;
    err.length = 0;
    return main(argv, {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => stdin,
    });
  };
  const receiptCalls = () => calls.filter((c) => c.tool === "generate_receipt");
  return { repo, calls, out, err, run, receiptCalls };
}

const OWN = [{ id: "req-1", text: "Add a pricing page", items: [] }];

describe("F: a session with a request but no changed file gets a receipt", () => {
  it("session end asks for a receipt with no files and prints 'No files changed'", async () => {
    const t = setup({ sessionRequests: OWN });
    await t.run(["hook", "session-start", "--agent", "claude"]);
    expect(await t.run(["hook", "session-end", "--agent", "claude"])).toBe(0);
    expect(t.receiptCalls()).toHaveLength(1);
    expect(t.receiptCalls()[0]?.args).toMatchObject({ requestId: "req-1", changedFiles: [] });
    expect(t.err.join("\n")).toContain("Codeceipt receipt: No files changed; 1 not done.");
  });

  it("no request and no changed file: still no receipt (nothing to report)", async () => {
    const t = setup();
    await t.run(["hook", "session-start", "--agent", "claude"]);
    await t.run(["hook", "session-end", "--agent", "claude"]);
    expect(t.receiptCalls()).toHaveLength(0);
  });
});

describe("I: the session-end hook sends dependency changes, names and ranges only", () => {
  it("the exact case: dayjs added to package.json is sent; scripts and the rest of the file never are", async () => {
    const t = setup({ sessionRequests: OWN });
    await t.run(["hook", "session-start", "--agent", "claude"]);
    const pkg = JSON.parse(readFileSync(join(t.repo, "package.json"), "utf8"));
    pkg.dependencies.dayjs = "^1.11.13";
    writeFileSync(join(t.repo, "package.json"), JSON.stringify(pkg, null, 2));
    await t.run(["hook", "session-end", "--agent", "claude"]);
    const sent = t.receiptCalls()[0]?.args?.packageJson as {
      path: string;
      before: string;
      after: string;
    }[];
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe("package.json");
    expect(JSON.parse(sent[0]?.after as string)).toEqual({
      dependencies: { react: "^18.2.0", dayjs: "^1.11.13" },
    });
    expect(JSON.parse(sent[0]?.before as string)).toEqual({ dependencies: { react: "^18.2.0" } });
    const raw = JSON.stringify(t.receiptCalls()[0]?.args);
    expect(raw).not.toContain("secret-build");
    expect(raw).not.toContain("scripts");
  });

  it("dependenciesOnly keeps only the four dependency sections; a file whose dependencies did not change is not sent", async () => {
    expect(
      dependenciesOnly(
        '{"name":"x","dependencies":{"a":"1"},"devDependencies":{"b":"2"},"x":{"c":"3"}}',
      ),
    ).toBe('{"dependencies":{"a":"1"},"devDependencies":{"b":"2"}}');
    expect(dependenciesOnly("not json")).toBeNull();
    const t = setup();
    writeFileSync(
      join(t.repo, "package.json"),
      JSON.stringify({ name: "renamed", dependencies: { react: "^18.2.0" } }),
    );
    expect(await dependencyChanges(runGit, t.repo, "HEAD", ["package.json"])).toEqual([]);
  });
});

describe("C: codeceipt last names what needs attention", () => {
  it("test checks with file and test names, masked findings, questions, postponed items and not-done items", () => {
    const lines = attentionLines({
      no_changes: false,
      items: [
        { text: "Which currency?", status: "question" },
        { text: "The footer has a link to /about", status: "postponed" },
        { text: "Add a pricing page", status: "missed" },
        { text: "A comment at the top", status: "done" },
      ],
      findings: [
        {
          type: "stripe_secret_key",
          file: "src/lib/demo-config.ts",
          line: 1,
          hint: "h",
          masked_value: "sk_l***",
          asked: true,
        },
      ],
      test_integrity: {
        flags: [
          {
            kind: "skipped_tests",
            file: "src/lib/permissions.test.ts",
            names: ["allows admins"],
            count: 1,
            asked: true,
          },
        ],
      },
      new_dependencies: [
        {
          name: "dayjs",
          range: "^1.11.13",
          path: "package.json",
          check: { recommendation: "ok_to_install" },
        },
      ],
    });
    expect(lines).toEqual([
      "Needs attention:",
      "  - Test check: Tests skipped or focused (1) in src/lib/permissions.test.ts: allows admins [You asked for this]",
      "  - Security finding: stripe secret key in src/lib/demo-config.ts:1 (sk_l***) [You asked for this]",
      "  - Question: Which currency?",
      "  - Postponed: The footer has a link to /about",
      "  - Missed: Add a pricing page",
      "  - Dependency: dayjs added ^1.11.13 in package.json (check_package: ok to install)",
    ]);
  });

  it("attack: terminal control characters and an unmasked secret from the server never reach the terminal", () => {
    const key = ["sk", "live", "Zr8Qw2Lm5Xp9Tn4Vb7"].join("_");
    const lines = attentionLines({
      items: [{ text: `Missed \u001b[31mred\u001b[0m ${key}`, status: "missed" }],
    }).join("\n");
    expect(lines).not.toContain("\u001b");
    expect(lines).not.toContain(key.slice(4));
  });
});

describe("macOS/npx: hooks work without a global install", () => {
  it("the install check ignores npx's temporary folder on PATH", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cc-npx-"));
    const npxBin = join(tmp, ".npm", "_npx", "abc123", "node_modules", ".bin");
    mkdirSync(npxBin, { recursive: true });
    writeFileSync(join(npxBin, "codeceipt"), "#!/bin/sh\n");
    expect(onPath("codeceipt", { PATH: npxBin }, "linux")).toBe(false);
    const global = join(tmp, "global-bin");
    mkdirSync(global);
    writeFileSync(join(global, "codeceipt"), "#!/bin/sh\n");
    expect(onPath("codeceipt", { PATH: [npxBin, global].join(delimiter) }, "linux")).toBe(true);
  });

  it("the hook command runs the installed codeceipt, else npx, with the usual Node folders on PATH (real sh)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-shim-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    // A fake npx records how it was called; no codeceipt is installed.
    writeFileSync(join(bin, "npx"), '#!/bin/sh\necho "npx $*"\n', { mode: 0o755 });
    const run = (path: string) =>
      execFileSync("/bin/sh", ["-c", shellHook("codeceipt hook stop --agent claude")], {
        env: { PATH: path, HOME: dir },
      }).toString();
    expect(run(`${bin}:/usr/bin:/bin`)).toBe("npx -y codeceipt hook stop --agent claude\n");
    writeFileSync(join(bin, "codeceipt"), '#!/bin/sh\necho "codeceipt $*"\n', { mode: 0o755 });
    expect(run(`${bin}:/usr/bin:/bin`)).toBe("codeceipt hook stop --agent claude\n");
    // A GUI app's PATH without the user's folders: $HOME/.local/bin is added by the hook itself.
    mkdirSync(join(dir, ".local", "bin"), { recursive: true });
    writeFileSync(join(dir, ".local", "bin", "codeceipt"), '#!/bin/sh\necho "home $*"\n', {
      mode: 0o755,
    });
    expect(run("/usr/bin:/bin")).toBe("home hook stop --agent claude\n");
  });

  it("init writes the shell form plus Claude Code's Stop hook, and upgrades an older bare hook in place", async () => {
    const t = setup();
    mkdirSync(join(t.repo, ".claude"), { recursive: true });
    writeFileSync(
      join(t.repo, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          SessionEnd: [
            {
              hooks: [
                {
                  type: "command",
                  command: "codeceipt hook session-end --agent claude",
                  timeout: 60,
                },
              ],
            },
          ],
        },
      }),
    );
    expect(await t.run(["init", "--claude"])).toBe(0);
    const hooks = JSON.parse(readFileSync(join(t.repo, ".claude", "settings.json"), "utf8")).hooks;
    expect(hooks.SessionEnd).toEqual([
      {
        hooks: [
          {
            type: "command",
            command: shellHook("codeceipt hook session-end --agent claude"),
            timeout: 60,
          },
        ],
      },
    ]);
    expect(hooks.Stop).toEqual([
      {
        hooks: [
          {
            type: "command",
            command: shellHook("codeceipt hook stop --agent claude"),
            timeout: 60,
          },
        ],
      },
    ]);
    expect(t.out.join("\n")).toContain("SessionEnd hook (now runs without a global install)");
    t.out.length = 0;
    expect(await t.run(["init", "--claude"])).toBe(0);
    expect(t.out.filter((l) => l.startsWith("  added"))).toEqual([]);
  });
});

describe("VS Code: the Stop hook keeps one receipt per session", () => {
  it("Stop makes the receipt; a Stop with nothing new sends nothing; a later change replaces it; session end replaces it too", async () => {
    const t = setup({ sessionRequests: OWN });
    await t.run(["hook", "session-start", "--agent", "claude"]);
    writeFileSync(join(t.repo, "src", "a.ts"), "export const a = 2;\n");
    expect(await t.run(["hook", "stop", "--agent", "claude"])).toBe(0);
    expect(t.receiptCalls()).toHaveLength(1);
    expect(t.receiptCalls()[0]?.args?.replacesReceiptId).toBeUndefined();
    await t.run(["hook", "stop", "--agent", "claude"]);
    expect(t.receiptCalls()).toHaveLength(1);
    writeFileSync(join(t.repo, "src", "b.ts"), "export const b = 1;\n");
    await t.run(["hook", "stop", "--agent", "claude"]);
    expect(t.receiptCalls()).toHaveLength(2);
    expect(t.receiptCalls()[1]?.args?.replacesReceiptId).toBe("rc-1");
    await t.run(["hook", "session-end", "--agent", "claude"]);
    expect(t.receiptCalls()).toHaveLength(3);
    expect(t.receiptCalls()[2]?.args?.replacesReceiptId).toBe("rc-2");
  });
});

describe("H: the session's open list skips questions and repeated items", () => {
  it("next step is the first real open item; questions and duplicates are not listed as work", async () => {
    const t = setup({
      requests: [
        {
          id: "r2",
          text: "Add a pricing page",
          items: [
            { text: "Which currency?", status: "open", question: true },
            { text: "Add a pricing page", status: "open" },
          ],
        },
        {
          id: "r1",
          text: "Add a pricing page",
          items: [{ text: "Add a pricing page", status: "missed" }],
        },
      ],
    });
    await t.run(["hook", "session-start", "--agent", "claude"]);
    await t.run(["hook", "session-end", "--agent", "claude"]);
    const save = t.calls.find((c) => c.tool === "save_progress");
    expect(save?.args?.nextStep).toBe("Add a pricing page");
    expect(save?.args?.unfinished).toBe("Add a pricing page");
  });
});
