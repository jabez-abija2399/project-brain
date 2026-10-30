import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeConfig } from "./config";
import { type CliDeps, main } from "./index";
import { readRepoLink } from "./repo-link";
import { linkRepo } from "./test-support";

// Launch security pass (independent review): attacks on `npx codeceipt`, the per-repo link and the agents' token
// helpers. Fake secrets are built at runtime in chunks under 10 characters.
const TOKEN_A = ["pb_", "aaaa", "Q7xT2", "mK9vR"].join("");
const TOKEN_B = ["pb_", "bbbb", "Z8yW1", "qL4nP"].join("");
const DEVICE = ["dv_", "secret", "Xy81", "Lq0z"].join("");
const API = "https://brain.test";
const EVIL = "https://evil.test";

type Seen = { url: string; auth: string | null; redirect: RequestRedirect | undefined };

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "cc-sec-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# app\n");
  writeFileSync(join(dir, "app.tsx"), "export function App() {\n  return null;\n}\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  return dir;
}
const home = () => mkdtempSync(join(tmpdir(), "cc-sec-home-"));
const configFile = (h: string) => join(h, ".config", "codeceipt", "config.json");

// A server that runs the device flow and hands out TOKEN_A, while trying to steer the CLI to another host.
function deviceServer(overrides: { userCode?: string; projectId?: string } = {}) {
  const seen: Seen[] = [];
  const fetchImpl: CliDeps["fetch"] = async (url, init) => {
    const u = new URL(String(url));
    seen.push({
      url: String(url),
      auth: new Headers(init?.headers).get("authorization"),
      redirect: init?.redirect,
    });
    if (u.pathname === "/api/device/start") {
      return Response.json({
        device_code: DEVICE,
        user_code: overrides.userCode ?? "BCDF-GHJK",
        verification_uri: `${EVIL}/device`,
        verification_uri_complete: `${EVIL}/device?code=BCDF-GHJK`,
        expires_in: 600,
        interval: 5,
      });
    }
    if (u.pathname === "/api/device/token") {
      return Response.json({
        access_token: TOKEN_A,
        project_id: overrides.projectId ?? "proj-a",
        api_url: EVIL,
      });
    }
    if (u.pathname === "/api/token/whoami")
      return Response.json({ ok: true, project_id: "proj-a" });
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
  return { seen, fetchImpl };
}

function run(
  argv: string[],
  opts: {
    cwd: string;
    home: string;
    fetch: CliDeps["fetch"];
    env?: Record<string, string>;
    git?: CliDeps["git"];
    lines?: string[];
    opened?: string[];
  },
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, {
    fetch: opts.fetch,
    env: { HOME: opts.home, XDG_CONFIG_HOME: join(opts.home, ".config"), ...(opts.env ?? {}) },
    cwd: opts.cwd,
    homedir: opts.home,
    platform: "linux",
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
    readStdin: async () => "",
    sleep: async () => {},
    openUrl: async (u) => {
      opts.opened?.push(u);
      return true;
    },
    hasCommand: () => true,
    stdinLines: async function* () {
      yield* opts.lines ?? [];
    },
    ...(opts.git ? { git: opts.git } : {}),
  });
  return code.then((c) => ({ code: c, out, err }));
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) return n === "objects" ? [] : filesUnder(p);
    return [p];
  });
}

const noFetch: CliDeps["fetch"] = async () => {
  throw new Error("no network expected");
};

describe("launch: npx codeceipt and per-repo tokens under attack", () => {
  it("attack: a server answer naming another host (verification_uri, api_url) never moves the browser or the token there", async () => {
    const h = home();
    const dir = gitRepo();
    const s = deviceServer();
    const opened: string[] = [];
    const r = await run(["--api-url", API], { cwd: dir, home: h, fetch: s.fetchImpl, opened });
    expect(r.code).toBe(0);
    expect(opened).toEqual([`${API}/device?code=BCDF-GHJK`]);
    expect(s.seen.filter((c) => !c.url.startsWith(`${API}/`))).toEqual([]);
    // Every request that carries the token refuses redirects.
    expect(s.seen.filter((c) => c.auth !== null && c.redirect !== "error")).toEqual([]);
    expect(readRepoLink(join(dir, ".git"))).toEqual({ apiUrl: API, projectId: "proj-a" });
    expect(JSON.parse(readFileSync(configFile(h), "utf8")).projects[0].apiUrl).toBe(API);
  });

  it("attack: the token and the device code never land in the repo (working tree or .git) or the terminal output", async () => {
    const h = home();
    const dir = gitRepo();
    mkdirSync(join(dir, ".claude"));
    mkdirSync(join(dir, ".cursor"));
    const s = deviceServer();
    const r = await run(["--api-url", API], { cwd: dir, home: h, fetch: s.fetchImpl });
    expect(r.code).toBe(0);
    for (const f of filesUnder(dir)) {
      const text = readFileSync(f, "utf8");
      expect([f, text.includes(TOKEN_A) || text.includes(DEVICE)]).toEqual([f, false]);
    }
    const printed = [...r.out, ...r.err].join("\n");
    expect(printed).not.toContain(TOKEN_A);
    expect(printed).not.toContain(DEVICE);
  });

  it("attack: a user code carrying terminal escapes, or a project id with path tricks, is refused and nothing is linked", async () => {
    const h = home();
    for (const overrides of [
      { userCode: "\u001b]8;;https://evil.test\u0007BCDF-GHJK" },
      { userCode: "BCDF-GHJK\n" },
      { projectId: "../../etc" },
      { projectId: "proj-a\u001b[2J" },
    ]) {
      const dir = gitRepo();
      const s = deviceServer(overrides);
      const r = await run(["--api-url", API], { cwd: dir, home: h, fetch: s.fetchImpl });
      expect(r.code).not.toBe(0);
      expect([...r.out, ...r.err].join("\n")).not.toContain("\u001b");
      expect(readRepoLink(join(dir, ".git"))).toBeNull();
    }
  });

  it("attack: a plain-http or foreign --api-url is refused before anything is sent", async () => {
    const h = home();
    const dir = gitRepo();
    for (const url of [
      "http://brain.test",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "http://localhost.evil.test",
    ]) {
      const r = await run(["--api-url", url], { cwd: dir, home: h, fetch: noFetch });
      expect([url, r.code]).toEqual([url, 2]);
    }
  });

  it("attack: a link file that points at another server, or downgrades to http, never gets the token from mcp-headers or the proxy", async () => {
    const h = home();
    const dir = gitRepo();
    linkRepo(dir, configFile(h), { apiUrl: API, projectId: "proj-a", token: TOKEN_A });
    for (const apiUrl of [EVIL, "http://brain.test", "https://brain.test:8443"]) {
      writeFileSync(
        join(dir, ".git", "codeceipt", "project.json"),
        JSON.stringify({ apiUrl, projectId: "proj-a" }),
      );
      const headers = await run(["mcp-headers"], {
        cwd: dir,
        home: h,
        fetch: noFetch,
        env: { CLAUDE_CODE_MCP_SERVER_URL: `${apiUrl}/mcp` },
      });
      expect([apiUrl, headers.out]).toEqual([apiUrl, ["{}"]]);
      const seen: string[] = [];
      const proxy = await run(["mcp-proxy", "--repo", dir], {
        cwd: dir,
        home: h,
        fetch: async (u) => {
          seen.push(String(u));
          return Response.json({});
        },
        lines: [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })],
      });
      expect(seen).toEqual([]);
      expect(proxy.out.join("\n")).not.toContain(TOKEN_A);
    }
  });

  it("attack: mcp-headers gives no token to a lookalike server URL (userinfo, subdomain, scheme, port)", async () => {
    const h = home();
    const dir = gitRepo();
    linkRepo(dir, configFile(h), { apiUrl: API, projectId: "proj-a", token: TOKEN_A });
    for (const url of [
      "https://brain.test@evil.test/mcp",
      "https://brain.test.evil.test/mcp",
      "http://brain.test/mcp",
      "https://brain.test:444/mcp",
      "",
      "not a url",
    ]) {
      const r = await run(["mcp-headers"], {
        cwd: dir,
        home: h,
        fetch: noFetch,
        env: { CLAUDE_CODE_MCP_SERVER_URL: url },
      });
      expect([url, r.out]).toEqual([url, ["{}"]]);
    }
    const ok = await run(["mcp-headers"], {
      cwd: dir,
      home: h,
      fetch: noFetch,
      env: { CLAUDE_CODE_MCP_SERVER_URL: `${API}/mcp` },
    });
    expect(ok.out.join("")).toContain(TOKEN_A);
  });

  it("attack: a symlinked .git/codeceipt folder or link file is never followed (read or write)", async () => {
    const h = home();
    const outside = mkdtempSync(join(tmpdir(), "cc-sec-out-"));
    writeFileSync(
      join(outside, "project.json"),
      JSON.stringify({ apiUrl: API, projectId: "proj-b" }),
    );
    // Folder symlink.
    const a = gitRepo();
    symlinkSync(outside, join(a, ".git", "codeceipt"));
    expect(readRepoLink(join(a, ".git"))).toBeNull();
    // File symlink.
    const b = gitRepo();
    mkdirSync(join(b, ".git", "codeceipt"));
    symlinkSync(join(outside, "project.json"), join(b, ".git", "codeceipt", "project.json"));
    expect(readRepoLink(join(b, ".git"))).toBeNull();
    // A login in either repo leaves the outside file untouched.
    const whoami: CliDeps["fetch"] = async () => Response.json({ ok: true, project_id: "proj-a" });
    for (const dir of [a, b]) {
      await run(["login", "--api-url", API], { cwd: dir, home: h, fetch: whoami }).catch(
        () => null,
      );
    }
    expect(JSON.parse(readFileSync(join(outside, "project.json"), "utf8")).projectId).toBe(
      "proj-b",
    );
  });

  it("attack: mcp-proxy never echoes a server error body (which could carry the token) and refuses redirects", async () => {
    const h = home();
    const dir = gitRepo();
    linkRepo(dir, configFile(h), { apiUrl: API, projectId: "proj-a", token: TOKEN_A });
    const redirects: (RequestRedirect | undefined)[] = [];
    const statuses = [500, 302, 401, 413];
    let i = 0;
    const r = await run(["mcp-proxy", "--repo", dir], {
      cwd: dir,
      home: h,
      fetch: async (_u, init) => {
        redirects.push(init?.redirect);
        return new Response(`echo ${TOKEN_A} <script>`, {
          status: statuses[i++] ?? 500,
          headers: { location: `${EVIL}/steal` },
        });
      },
      lines: statuses.map((_, id) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/list" })),
    });
    expect(r.code).toBe(0);
    expect(redirects.every((x) => x === "error")).toBe(true);
    expect(r.out).toHaveLength(statuses.length);
    expect([...r.out, ...r.err].join("\n")).not.toContain(TOKEN_A);
  });

  it("attack: when git cannot read a linked repo (dubious ownership, git missing), the agents never fall back to another project's default login", async () => {
    const h = home();
    // The default login (outside any repo) is project A; this repo is linked to project B.
    writeConfig(configFile(h), { apiUrl: API, projectId: "proj-a", token: TOKEN_A });
    const dir = gitRepo();
    linkRepo(dir, configFile(h), { apiUrl: API, projectId: "proj-b", token: TOKEN_B });
    const brokenGit: CliDeps["git"] = async () => {
      throw new Error("fatal: detected dubious ownership in repository");
    };
    const headers = await run(["mcp-headers"], {
      cwd: dir,
      home: h,
      fetch: noFetch,
      git: brokenGit,
      env: { CLAUDE_CODE_MCP_SERVER_URL: `${API}/mcp` },
    });
    expect(headers.out.join("")).not.toContain(TOKEN_A);
    const seen: (string | null)[] = [];
    await run(["mcp-proxy", "--repo", dir], {
      cwd: dir,
      home: h,
      git: brokenGit,
      fetch: async (_u, init) => {
        seen.push(new Headers(init?.headers).get("authorization"));
        return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
      },
      lines: [JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })],
    });
    expect(seen.filter((a) => a?.includes(TOKEN_A))).toEqual([]);
  });
});
