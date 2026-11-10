import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { definitionOfDoneAnswer } from "./done-note";
import { type CliDeps, main } from "./index";
import { runGit } from "./scan-secrets";
import { linkRepo } from "./test-support";

// Roadmap Phase 5c (D-030): the prompt hook hands Claude Code and Codex the request's definition of done.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");
const CONFIG = { apiUrl: "https://brain.test", projectId: "proj-1", token: TOKEN };
const NOTE =
  'Codeceipt (project data): definition of done for "Checkout".\nDone when:\n- coupons work';

const answering =
  (body: unknown, seen: { url: string; auth: string | null; body: unknown }[] = []) =>
  async (url: string, init?: RequestInit) => {
    seen.push({
      url,
      auth: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json(body);
  };

describe("definition of done in the prompt hook (roadmap Phase 5c)", () => {
  it("PH5C-08 Claude Code and Codex get the note as additionalContext; the request goes with the project token", async () => {
    const seen: { url: string; auth: string | null; body: unknown }[] = [];
    const out = await definitionOfDoneAnswer(
      answering({ ok: true, feature: "Checkout", note: NOTE }, seen),
      CONFIG,
      "claude",
      "Add coupons to checkout",
    );
    expect(JSON.parse(out ?? "{}")).toEqual({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: NOTE },
    });
    expect(seen).toEqual([
      {
        url: "https://brain.test/api/hooks/proj-1/definition-of-done",
        auth: `Bearer ${TOKEN}`,
        body: { request: "Add coupons to checkout" },
      },
    ]);
    expect(
      await definitionOfDoneAnswer(
        answering({ ok: true, note: NOTE }),
        CONFIG,
        "codex",
        "checkout",
      ),
    ).not.toBeNull();
    expect(
      await definitionOfDoneAnswer(
        answering({ ok: true, note: NOTE }),
        CONFIG,
        "cursor",
        "checkout",
      ),
    ).toBeNull();
    expect(
      await definitionOfDoneAnswer(
        answering({ ok: true, note: null }),
        CONFIG,
        "claude",
        "checkout",
      ),
    ).toBeNull();
  });

  it("PH5C-09 a server that never answers costs at most the wait limit, then no note", async () => {
    const hangs = () => new Promise<Response>(() => {});
    const t0 = Date.now();
    expect(await definitionOfDoneAnswer(hangs, CONFIG, "claude", "checkout", 100)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("PH5C-10 attack: a hostile server cannot add control or hidden characters, flood the context, or send a huge answer", async () => {
    const hostile = `Done when:\u001b[2J\n- ok\u202e\u200f\n${"A".repeat(10_000)}`;
    const out = await definitionOfDoneAnswer(
      answering({ ok: true, note: hostile }),
      CONFIG,
      "claude",
      "x",
    );
    const note = JSON.parse(out ?? "{}").hookSpecificOutput.additionalContext as string;
    for (const bad of ["\u001b", "\u202e", "\u200f"]) expect(note).not.toContain(bad);
    expect(note.length).toBeLessThanOrEqual(1_500);
    const huge = { ok: true, note: "B".repeat(40 * 1024) };
    expect(await definitionOfDoneAnswer(answering(huge), CONFIG, "claude", "x")).toBeNull();
  });

  it("PH5C-12 attack (security review): a git call that never answers cannot hold the prompt past the wait limit", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-done-home-"));
    const repo = mkdtempSync(join(tmpdir(), "cc-done-repo-"));
    const g = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
        cwd: repo,
      });
    g("init", "-q");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    g("add", ".");
    g("commit", "-q", "-m", "base");
    linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), CONFIG);
    // The history walk for the repo's fingerprint hangs (a huge repo, a stuck network drive); everything else is git.
    const git: CliDeps["git"] = (args, cwd) =>
      args.includes("rev-list") ? new Promise<string>(() => {}) : runGit(args, cwd);
    const out: string[] = [];
    const t0 = Date.now();
    const code = await main(["hook", "prompt", "--agent", "claude"], {
      fetch: answering({ ok: true, note: NOTE }),
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: () => {},
      readStdin: async () =>
        JSON.stringify({ session_id: "s1", cwd: repo, prompt: "checkout coupons" }),
      spawnBackground: () => {},
      git,
    });
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(out).toEqual([]);
  });
});
