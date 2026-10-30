import { readCapped } from "./api";
import type { CliConfig } from "./config";

// Launch part 3: Cursor cannot ask a helper for headers, so it runs this stdio MCP server instead of reading
// CODECEIPT_TOKEN. Each JSON-RPC message from Cursor (one per line) is posted to the repo's Codeceipt server with
// that project's token from the user config; the answers go back one per line. The token is only ever sent to the
// server it was issued by, and never written to stdout or stderr.
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_LINE_BYTES = 1024 * 1024;
const MAX_ANSWER_BYTES = 4 * 1024 * 1024;

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown };

const errorFor = (id: unknown, code: number, message: string) =>
  JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });

// JSON-RPC messages in a Streamable HTTP answer: plain JSON (one message or a batch) or server-sent events.
function messagesIn(body: string, contentType: string): unknown[] {
  const parse = (text: string): unknown[] => {
    try {
      const value = JSON.parse(text) as unknown;
      return Array.isArray(value) ? value : [value];
    } catch {
      return [];
    }
  };
  if (!contentType.includes("text/event-stream")) return parse(body);
  return body
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .flatMap((l) => parse(l.slice(5).trim()));
}

export async function runMcpProxy(
  lines: AsyncIterable<string>,
  config: CliConfig | { problem: string },
  fetchImpl: Fetch,
  write: (line: string) => void,
): Promise<void> {
  for await (const raw of lines) {
    if (raw.length > MAX_LINE_BYTES) continue;
    let msg: Message;
    try {
      msg = JSON.parse(raw) as Message;
    } catch {
      continue;
    }
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) continue;
    // Notifications (no id) get no answer, also when something fails.
    const isRequest = msg.id !== undefined && msg.id !== null;
    if ("problem" in config) {
      if (isRequest) write(errorFor(msg.id, -32001, config.problem));
      continue;
    }
    let res: Response;
    try {
      res = await fetchImpl(`${config.apiUrl.replace(/\/+$/, "")}/mcp`, {
        method: "POST",
        // The API never redirects; following one could hand the token to another host.
        redirect: "error",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: raw,
      });
    } catch {
      if (isRequest) write(errorFor(msg.id, -32603, "Cannot reach the Codeceipt server."));
      continue;
    }
    const body = await readCapped(res, MAX_ANSWER_BYTES).catch(() => null);
    if (res.status === 401 || res.status === 404) {
      if (isRequest) {
        write(
          errorFor(
            msg.id,
            -32001,
            "The project token was rejected: run `npx codeceipt` here again.",
          ),
        );
      }
      continue;
    }
    if (!res.ok || body === null) {
      if (isRequest) write(errorFor(msg.id, -32603, `Codeceipt server error (${res.status}).`));
      continue;
    }
    for (const answer of messagesIn(body, res.headers.get("content-type") ?? "")) {
      if (typeof answer === "object" && answer !== null) write(JSON.stringify(answer));
    }
  }
}
