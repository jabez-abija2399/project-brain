import { spawn } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build.mjs";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const fixture = join(pkgDir, "../../tests/fixtures/component-app");
const TOKEN = "pb_bin-test-token-value";

type Run = { code: number | null; stdout: string; stderr: string };

// Runs the built bin as a separate process, the way a terminal does: real argv, stdin, env, fetch. It runs in a fresh
// folder outside any git repo, so a login can never link (D-020) the repository the tests run from.
function run(bin: string, args: string[], env: Record<string, string>, stdin = ""): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: mkdtempSync(join(tmpdir(), "pb-cwd-")),
      env: { PATH: process.env.PATH ?? "", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

// Each test spawns node; under a loaded machine 5 s is not enough, so a generous limit keeps it load-independent.
describe("FEAT-008 the built codeceipt bin runs from a terminal", { timeout: 30_000 }, () => {
  let bin: string;
  let buildDir: string;
  let server: ReturnType<typeof createServer>;
  let apiUrl: string;
  let evil: ReturnType<typeof createServer>;
  let evilUrl: string;
  const evilSeen: string[] = [];
  const seen: { method: string; path: string; auth: string | undefined }[] = [];

  beforeAll(async () => {
    // A fresh build dir inside the package: the bin resolves typescript/ignore/libpg-query from node_modules, which
    // only works from inside the package. A unique dir avoids the root-owned dist/ file a root run leaves behind.
    buildDir = mkdtempSync(join(pkgDir, ".bin-test-"));
    bin = await build({ outDir: buildDir });
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";
      req.on("data", (d) => {
        body += d;
      });
      req.on("end", () => {
        seen.push({
          method: req.method ?? "",
          path: req.url ?? "",
          auth: req.headers.authorization,
        });
        const json = (status: number, data: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(data));
        };
        if (req.url?.startsWith("/redirect/")) {
          res.writeHead(302, { location: `${evilUrl}${req.url.slice("/redirect".length)}` });
          return res.end();
        }
        if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { ok: false });
        if (req.url === "/api/token/whoami") return json(200, { ok: true, project_id: "proj-1" });
        if (req.url === "/api/index/proj-1/diff") {
          const files = (JSON.parse(body) as { files: { path: string }[] }).files;
          return json(200, { ok: true, changed: files.map((f) => f.path), deleted: [] });
        }
        if (req.url === "/api/index/proj-1") return json(200, { ok: true });
        if (req.url === "/api/index/proj-1/features")
          return json(200, { ok: true, features: 1, shared: 0 });
        if (req.url === "/api/index/proj-1/summarize")
          return json(200, { ok: true, attempted: 0, remaining: 0, enabled: true });
        json(404, { ok: false });
      });
    });
    evil = createServer((req, res) => {
      evilSeen.push(`${req.url} ${req.headers.authorization ?? ""}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, project_id: "evil" }));
    });
    await new Promise<void>((r) => evil.listen(0, "127.0.0.1", r));
    evilUrl = `http://127.0.0.1:${(evil.address() as AddressInfo).port}`;
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);
  afterAll(() => {
    server?.close();
    evil?.close();
    if (buildDir) rmSync(buildDir, { recursive: true, force: true });
  });

  it("AC-008-13 prints usage and exits 2 without a command; index before login exits 3", async () => {
    const home = mkdtempSync(join(tmpdir(), "pb-home-"));
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
    const usage = await run(bin, [], env);
    expect(usage.code).toBe(2);
    expect(usage.stderr).toContain("codeceipt login");
    const index = await run(bin, ["index"], env);
    expect(index.code).toBe(3);
    expect(index.stderr).toContain("Not logged in");
  });

  it("AC-008-13 login reads the token from stdin and saves it 0600 outside the repo; index uploads metadata", async () => {
    const home = mkdtempSync(join(tmpdir(), "pb-home-"));
    const repo = mkdtempSync(join(tmpdir(), "pb-repo-"));
    cpSync(fixture, repo, { recursive: true });
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config") };

    const login = await run(bin, ["login", "--api-url", apiUrl], env, `${TOKEN}\n`);
    expect(login.stderr).toBe("");
    expect(login.code).toBe(0);
    expect(login.stdout).toContain("Logged in as project proj-1");
    expect(login.stdout).not.toContain(TOKEN);
    const config = join(home, ".config/codeceipt/config.json");
    expect(statSync(config).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(config, "utf8"))).toMatchObject({ token: TOKEN });

    const index = await run(bin, ["index", repo], env);
    expect(index.stderr).toBe("");
    expect(index.code).toBe(0);
    expect(index.stdout).toContain("Uploaded 6 changed, 0 unchanged");
    expect(index.stdout).not.toContain(TOKEN);
    expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /api/token/whoami",
      "POST /api/index/proj-1/diff",
      "POST /api/index/proj-1",
      "POST /api/index/proj-1/features",
      "POST /api/index/proj-1/summarize",
    ]);
  });
  it("AC-008-11 attack: the CLI never follows a redirect, so the token cannot be forwarded to another host", async () => {
    const home = mkdtempSync(join(tmpdir(), "pb-home-"));
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
    const login = await run(bin, ["login", "--api-url", `${apiUrl}/redirect`], env, `${TOKEN}\n`);
    expect(login.code).not.toBe(0);
    expect(evilSeen).toEqual([]);
    expect(`${login.stdout}${login.stderr}`).not.toContain(TOKEN);
  });
  it("AC-008-11 attack: index never follows a redirect either, so the token stays with the saved server", async () => {
    const home = mkdtempSync(join(tmpdir(), "pb-home-"));
    const repo = mkdtempSync(join(tmpdir(), "pb-repo-"));
    cpSync(fixture, repo, { recursive: true });
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, ".config") };
    mkdirSync(join(home, ".config/codeceipt"), { recursive: true });
    writeFileSync(
      join(home, ".config/codeceipt/config.json"),
      JSON.stringify({ apiUrl: `${apiUrl}/redirect`, projectId: "proj-1", token: TOKEN }),
      { mode: 0o600 },
    );
    const index = await run(bin, ["index", repo], env);
    expect(index.code).not.toBe(0);
    expect(evilSeen).toEqual([]);
    expect(`${index.stdout}${index.stderr}`).not.toContain(TOKEN);
  });
});
