import { POST } from "./route";

// A minimal HTTP MCP client for tests: one JSON-RPC call to /mcp as a real client sends it.
type ToolResult = { content?: { type: string; text: string }[]; isError?: boolean };
type RpcResponse = { status: number; body: string; result?: Record<string, unknown> };

let nextId = 1;

// One JSON-RPC call to /mcp as an HTTP MCP client sends it. The answer is a one-event SSE stream (or plain JSON).
export async function rpc(method: string, params: Record<string, unknown>, token: string | null) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
  };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const res = await POST(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
  const body = await res.text();
  const data = body.split("\n").find((l) => l.startsWith("data: "));
  let result: Record<string, unknown> | undefined;
  try {
    result = JSON.parse(data ? data.slice(6) : body).result;
  } catch {
    result = undefined;
  }
  return { status: res.status, body, result } satisfies RpcResponse;
}

export async function callTool(name: string, args: Record<string, unknown>, token: string) {
  const res = await rpc("tools/call", { name, arguments: args }, token);
  const result = res.result as ToolResult | undefined;
  const text = result?.content?.[0]?.text ?? "";
  return { ...res, text, isError: result?.isError === true };
}
