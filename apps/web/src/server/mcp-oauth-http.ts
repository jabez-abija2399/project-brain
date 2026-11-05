import { NextResponse } from "next/server";
import type { Json } from "./mcp-oauth";

// The OAuth endpoints answer with their own JSON result: the status and body the protocol needs, never a cache.
export function oauthJson(result: Json): NextResponse {
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "cache-control": "no-store" },
  });
}
