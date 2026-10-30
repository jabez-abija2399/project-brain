import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliDeps, main } from "./index";
import { linkRepo } from "./test-support";

// Launch part 3: agents never need CODECEIPT_TOKEN. Claude Code asks the CLI's header helper; Cursor runs the CLI's
// stdio proxy. Both take the token from the user config, for the repo's project, and only for its own server.
const TOKEN_A = ["pb_", "aaaa", "Q7xT2", "mK9vR"].join("");
const TOKEN_B = ["pb_", "bbbb", "Z8yW1", "qL4nP"].join("");
const API = "https://brain.test";

function repo(home: string, projectId: string, token: string, dirs = [".claude", ".cursor"]) {
  const dir = mkdtempSync(join(tmpdir(), "cc-auth-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const d of dirs) mkdirSync(join(dir, d), { recursive: true });
  linkRepo(dir, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: API,
    projectId,
    token,
  });
  return dir;
}

function cli(home: string, cwd: string, fetchImpl: CliDeps["fetch"], lines: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const run = (...argv: string[]) => {
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
      readStdin: async () => "",
      stdinLines: async function* () {
        yield* lines;
      },
    });
  };
  return { out, err, run };
}

const noFetch: CliDeps["fetch"] = async () => {
  throw new Error("no network expected");
};
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("no environment variables for agents", () => {
  it("init sets up Claude Code with the header helper and Cursor with the stdio proxy, with no token variable anywhere", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-auth-home-"));
    const dir = repo(home, "proj-a", TOKEN_A);
    const c = cli(home, dir, noFetch);
    expect(await c.run("init")).toBe(0);
    expect(json(join(dir, ".mcp.json")).mcpServers.codeceipt).toEqual({
      type: "http",
      url: `${API}/mcp`,
      headersHelper: "codeceipt mcp-headers",
    });
    expect(json(join(dir, ".cursor/mcp.json")).mcpServers.codeceipt).toEqual({
      command: "codeceipt",
      args: ["mcp-proxy", "--repo", "${workspaceFolder}"],
    });
    for (const file of [".mcp.json", ".cursor/mcp.json"]) {
      expect(readFileSync(join(dir, file), "utf8")).not.toMatch(
        /CODECEIPT_TOKEN|PROJECTBRAIN_TOKEN/,
      );
    }
    expect(c.out.join("\n")).not.toContain("CODECEIPT_TOKEN");
  });

  it("init upgrades our entries that still read a token variable, and a second run changes nothing", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-auth-home-"));
    const dir = repo(home, "proj-a", TOKEN_A);
    writeFileSync(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          codeceipt: {
            type: "http",
            url: `${API}/mcp`,
            headers: { Authorization: "Bearer ${CODECEIPT_TOKEN}" },
            headersHelper: "codeceipt mcp-headers",
          },
        },
      }),
    );
    writeFileSync(
      join(dir, ".cursor/mcp.json"),
      JSON.stringify({
        mcpServers: {
          codeceipt: {
            url: `${API}/mcp`,
            headers: { Authorization: "Bearer ${env:CODECEIPT_TOKEN}" },
          },
        },
      }),
    );
    const c = cli(home, dir, noFetch);
    expect(await c.run("init")).toBe(0);
    expect(json(join(dir, ".mcp.json")).mcpServers.codeceipt).toEqual({
      type: "http",
      url: `${API}/mcp`,
      headersHelper: "codeceipt mcp-headers",
    });
    expect(json(join(dir, ".cursor/mcp.json")).mcpServers.codeceipt).toEqual({
      command: "codeceipt",
      args: ["mcp-proxy", "--repo", "${workspaceFolder}"],
    });
    expect(c.out).toContain(
      "  added   .mcp.json: MCP server codeceipt (token now from the codeceipt helper)",
    );
    expect(await c.run("init")).toBe(0);
    expect(c.out.filter((l) => l.startsWith("  added"))).toEqual([]);
  });

  it("the Cursor proxy forwards the agent's MCP messages with the repo's own token, to its own server only", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-auth-home-"));
    const a = repo(home, "proj-a", TOKEN_A);
    const b = repo(home, "proj-b", TOKEN_B);
    const seen: { url: string; auth: string | null; body: string }[] = [];
    const fetchImpl: CliDeps["fetch"] = async (url, init) => {
      seen.push({
        url: String(url),
        auth: new Headers(init?.headers).get("authorization"),
        body: String(init?.body),
      });
      const msg = JSON.parse(String(init?.body));
      if (msg.id === undefined) return new Response(null, { status: 202 });
      if (msg.method === "tools/list") {
        return new Response(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      return Response.json({ jsonrpc: "2.0", id: msg.id, result: { ok: true } });
    };
    const lines = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    ];
    // Cursor starts the proxy with --repo ${workspaceFolder}; the process's own folder does not matter.
    const c = cli(home, tmpdir(), fetchImpl, lines);
    expect(await c.run("mcp-proxy", "--repo", b)).toBe(0);
    expect(c.out.map((l) => JSON.parse(l))).toEqual([
      { jsonrpc: "2.0", id: 1, result: { ok: true } },
      { jsonrpc: "2.0", id: 2, result: { tools: [] } },
    ]);
    expect(new Set(seen.map((s) => `${s.url} ${s.auth}`))).toEqual(
      new Set([`${API}/mcp Bearer ${TOKEN_B}`]),
    );
    seen.length = 0;
    const ca = cli(home, tmpdir(), fetchImpl, lines.slice(0, 1));
    expect(await ca.run("mcp-proxy", "--repo", a)).toBe(0);
    expect(seen.map((s) => s.auth)).toEqual([`Bearer ${TOKEN_A}`]);
  });

  it("attack: the proxy for an unlinked repo answers with a clear MCP error and sends nothing", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-auth-home-"));
    repo(home, "proj-a", TOKEN_A);
    const plain = mkdtempSync(join(tmpdir(), "cc-auth-plain-"));
    execFileSync("git", ["init", "-q"], { cwd: plain });
    const c = cli(home, plain, noFetch, [
      JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
      "not json",
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ]);
    expect(await c.run("mcp-proxy")).toBe(0);
    expect(c.out.map((l) => JSON.parse(l))).toEqual([
      {
        jsonrpc: "2.0",
        id: 7,
        error: {
          code: -32001,
          message: "This repo is not linked to a Codeceipt project: run `npx codeceipt` here.",
        },
      },
    ]);
  });

  it("attack: a server error or an oversized answer is reported as an MCP error, never echoed", async () => {
    const home = mkdtempSync(join(tmpdir(), "cc-auth-home-"));
    const dir = repo(home, "proj-a", TOKEN_A);
    const fetchImpl: CliDeps["fetch"] = async () =>
      new Response(`<html>${TOKEN_A}</html>`, { status: 500 });
    const c = cli(home, dir, fetchImpl, [
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    ]);
    expect(await c.run("mcp-proxy")).toBe(0);
    expect(c.out.map((l) => JSON.parse(l))).toEqual([
      { jsonrpc: "2.0", id: 3, error: { code: -32603, message: "Codeceipt server error (500)." } },
    ]);
    expect([...c.out, ...c.err].join("\n")).not.toContain(TOKEN_A);
  });
});
