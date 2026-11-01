import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// The path a signed-out visitor asked for, so the sign-in page can bring them back to it. It is set here on every
// page request (overwriting anything a client sent) and only ever used after safeNextPath has checked it.
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set("x-codeceipt-path", `${req.nextUrl.pathname}${req.nextUrl.search}`.slice(0, 300));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not the API, Next.js assets or files.
  matcher: ["/((?!api|mcp|_next|.*\\..*).*)"],
};
