import { describe, expect, it } from "vitest";
import { CliError, SUSPENDED_MESSAGE, request } from "./api";
import { callTool } from "./mcp-client";

// Admin abuse control (2026-11-01): a suspended project or account gets one clear CLI message, in the CLI's own
// words: the server's text is never printed.
const config = { apiUrl: "https://codeceipt.example", token: "pb_x", projectId: "p1" };

describe("suspension in the CLI", () => {
  it("an API 403 suspended prints the CLI's suspension message, not the server's text", async () => {
    const fetchImpl = async () =>
      Response.json({ ok: false, code: "suspended", message: "\u001b[31mEVIL" }, { status: 403 });
    const err = await request(fetchImpl, config, "GET", "/api/token/whoami").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toBe(SUSPENDED_MESSAGE);
    expect((err as Error).message).not.toContain("EVIL");
  });

  it("an MCP tool answering 'suspended' (the hooks' path) prints the same message", async () => {
    const fetchImpl = async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                code: -32001,
                message: "This Codeceipt project is suspended. Contact support.",
              }),
            },
          ],
        },
      });
    const err = await callTool(fetchImpl, config, "where_did_we_stop", {}).catch((e: unknown) => e);
    expect((err as Error).message).toBe(SUSPENDED_MESSAGE);
  });
});

describe("a revoked token", () => {
  it("tells the user to run npx codeceipt again (the setup that makes a new key), not the manual login", async () => {
    const fetchImpl = async () =>
      Response.json({ ok: false, code: "unauthenticated" }, { status: 401 });
    const err = await request(fetchImpl, config, "GET", "/api/token/whoami").catch(
      (e: unknown) => e,
    );
    expect((err as Error).message).toContain("run `npx codeceipt` in this repo again");
    const mcp = await callTool(
      async () => new Response("", { status: 401 }),
      config,
      "x",
      {},
    ).catch((e: unknown) => e);
    expect((mcp as Error).message).toContain("run `npx codeceipt` in this repo again");
  });
});

describe("only a real suspension says suspended", () => {
  it("an unrelated tool error that mentions the word is not shown as a suspension", async () => {
    const fetchImpl = async () =>
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify({ code: -32602, message: "feature suspended" }) },
          ],
        },
      });
    const err = await callTool(fetchImpl, config, "x", {}).catch((e: unknown) => e);
    expect((err as Error).message).toBe("x failed: feature suspended");
  });
});
