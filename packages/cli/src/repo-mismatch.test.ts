import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_MISMATCH_MESSAGE } from "./api";
import { type CliDeps, main } from "./index";

// Real-test bug J (2026-11-01): `npx codeceipt` in a second repository ("stock") said "already connected to project
// <the first repo's project>" and uploaded its 461 files into it. The link travelled with a copied .git folder. Now a
// link carries its repository's fingerprint (root commit, normalized remote): another repository is refused locally and
// on the server, `codeceipt unlink` removes the link, and `codeceipt index --rebuild` rebuilds from one repository.
const TOKEN = ["pb_", "appA", "Q7xT2", "mK9vR"].join("");
const API = "https://brain.test";

type Call = { path: string; repo: string | null };

function server(opts: { mismatch?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const path = new URL(String(url)).pathname;
    const headers = new Headers(init?.headers);
    calls.push({ path, repo: headers.get("x-codeceipt-repo") });
    if (opts.mismatch && !path.endsWith("/rebuild")) {
      return Response.json({ ok: false, code: "repo_mismatch" }, { status: 409 });
    }
    if (path === "/api/token/whoami") return Response.json({ ok: true, project_id: "proj-app" });
    if (path.endsWith("/rebuild")) return Response.json({ ok: true, removed: 461 });
    return Response.json({
      ok: true,
      files: 0,
      symbols: 0,
      changed: [],
      deleted: [],
      held: [],
      features: 0,
      shared: 0,
      attempted: 0,
      remaining: 0,
      enabled: false,
    });
  };
  return { calls, fetchImpl };
}

function repo(name: string, remote: string) {
  const dir = mkdtempSync(join(tmpdir(), `cc-${name}-`));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], {
      cwd: dir,
    }).toString();
  git("init", "-q");
  git("remote", "add", "origin", remote);
  writeFileSync(join(dir, "README.md"), `# ${name}\n`);
  git("add", ".");
  git("commit", "-q", "-m", `${name} base`);
  return { dir, git };
}

function cli(home: string, fetchImpl: CliDeps["fetch"]) {
  const out: string[] = [];
  const err: string[] = [];
  const run = (cwd: string, argv: string[], stdin = "") => {
    out.length = 0;
    err.length = 0;
    return main(argv, {
      fetch: fetchImpl,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => stdin,
    });
  };
  return { out, err, run };
}

const linkFile = (dir: string) => join(dir, ".git", "codeceipt", "project.json");
const readLink = (dir: string) => JSON.parse(readFileSync(linkFile(dir), "utf8"));

describe("J: a link belongs to one repository", () => {
  it("the first repo's link records its fingerprint; every upload sends the hashed fingerprint, never the URL", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const s = server();
    const app = repo("app", "git@github.com:acme/app.git");
    const c = cli(home, s.fetchImpl);
    expect(await c.run(app.dir, ["login", "--api-url", API], `${TOKEN}\n`)).toBe(0);
    writeFileSync(join(app.dir, "a.ts"), "export const a = 1;\n");
    expect(await c.run(app.dir, ["index"])).toBe(0);
    // The link learned the repository on first use.
    expect(readLink(app.dir).fingerprint).toEqual({
      root: app.git("rev-list", "--max-parents=0", "HEAD").trim(),
      remote: "github.com/acme/app",
    });
    const sent = s.calls.filter((x) => x.path.startsWith("/api/index/"));
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) {
      expect(call.repo).toMatch(/^r=[0-9a-f]{32};o=[0-9a-f]{32}$/);
      expect(call.repo).not.toContain("acme");
    }
  });

  it("attack: the exact case — a second repo ('stock') with the first repo's link copied into its .git uploads nothing", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const s = server();
    const app = repo("app", "git@github.com:acme/app.git");
    const stock = repo("stock", "git@github.com:acme/stock.git");
    const c = cli(home, s.fetchImpl);
    expect(await c.run(app.dir, ["login", "--api-url", API], `${TOKEN}\n`)).toBe(0);
    writeFileSync(join(app.dir, "button.tsx"), "export function Button() { return null; }\n");
    expect(await c.run(app.dir, ["index"])).toBe(0);
    // The .git/codeceipt folder travels with a copied repository.
    cpSync(join(app.dir, ".git", "codeceipt"), join(stock.dir, ".git", "codeceipt"), {
      recursive: true,
    });
    writeFileSync(join(stock.dir, "design-system.ts"), "export const button = 1;\n");
    s.calls.length = 0;
    expect(await c.run(stock.dir, ["index"])).not.toBe(0);
    expect(c.err.join("\n")).toContain(REPO_MISMATCH_MESSAGE);
    expect(s.calls).toEqual([]);
    // The same for the hooks: nothing about stock reaches the first repo's project.
    await c.run(stock.dir, ["receipt"]);
    expect(s.calls).toEqual([]);
  });

  it("attack: an older link without a fingerprint is refused by the server (409) with the same clear words", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const s = server({ mismatch: true });
    const stock = repo("stock", "git@github.com:acme/stock.git");
    const c = cli(home, s.fetchImpl);
    // An older CLI wrote this link (no fingerprint) and the token.
    expect(await c.run(stock.dir, ["login", "--api-url", API], `${TOKEN}\n`)).not.toBe(0);
    expect(c.err.join("\n")).toContain("not the one connected");
  });

  it("codeceipt unlink removes the link (and says so); a second unlink says there is nothing to unlink", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const s = server();
    const app = repo("app", "git@github.com:acme/app.git");
    const c = cli(home, s.fetchImpl);
    expect(await c.run(app.dir, ["login", "--api-url", API], `${TOKEN}\n`)).toBe(0);
    expect(await c.run(app.dir, ["unlink"])).toBe(0);
    expect(c.out.join("\n")).toContain("Disconnected this repo from project proj-app");
    expect(existsSync(linkFile(app.dir))).toBe(false);
    expect(await c.run(app.dir, ["unlink"])).toBe(0);
    expect(c.out.join("\n")).toContain("not connected");
  });

  it("codeceipt index --rebuild clears the stored index first, then indexes this repo only", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-home-"));
    const s = server();
    const app = repo("app", "git@github.com:acme/app.git");
    writeFileSync(join(app.dir, "button.tsx"), "export function Button() { return null; }\n");
    const c = cli(home, s.fetchImpl);
    expect(await c.run(app.dir, ["login", "--api-url", API], `${TOKEN}\n`)).toBe(0);
    s.calls.length = 0;
    expect(await c.run(app.dir, ["index", "--rebuild"])).toBe(0);
    const paths = s.calls.map((x) => x.path);
    expect(paths[0]).toBe("/api/index/proj-app/rebuild");
    expect(paths.slice(1).some((p) => p.startsWith("/api/index/proj-app"))).toBe(true);
    expect(c.out.join("\n")).toContain("Cleared the stored index (461 files)");
  });
});
