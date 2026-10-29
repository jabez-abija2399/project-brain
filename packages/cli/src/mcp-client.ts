import { CliError, EXIT } from "./api";
import type { CliConfig } from "./config";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
// A tool answer larger than this is not read (the handoff note and receipts are a few KB).
const MAX_ANSWER_BYTES = 1024 * 1024;
let nextId = 1;

/**
 * Calls one tool on the project's MCP server (FEAT-016 hooks) and returns its text. The token goes only in the
 * Authorization header; errors never include it or the server's answer, only the tool's error code.
 */
export async function callTool(
  fetchImpl: Fetch,
  config: Pick<CliConfig, "apiUrl" | "token">,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(`${config.apiUrl.replace(/\/+$/, "")}/mcp`, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
  } catch {
    throw new CliError(EXIT.server, `Cannot reach ${config.apiUrl}.`);
  }
  if (res.status === 401 || res.status === 404) {
    throw new CliError(
      EXIT.auth,
      "The project token was rejected: run `projectbrain login` again.",
    );
  }
  const body = await res.text().catch(() => "");
  if (!res.ok || body.length > MAX_ANSWER_BYTES) {
    throw new CliError(EXIT.server, `The server failed (${res.status}).`);
  }
  // Streamable HTTP answers as JSON or as one server-sent event ("data: {...}").
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  let result: { content?: { text?: unknown }[]; isError?: boolean } | undefined;
  try {
    result = JSON.parse(line ? line.slice(6) : body).result;
  } catch {
    result = undefined;
  }
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string")
    throw new CliError(EXIT.server, "The server sent an unreadable answer.");
  if (result?.isError) {
    let code = "error";
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === "string" && /^[\w ."-]{1,80}$/.test(parsed.message))
        code = parsed.message;
    } catch {}
    throw new CliError(EXIT.rejected, `${name} failed: ${code}`);
  }
  return text;
}
