import { NextResponse } from "next/server";

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;
  // Seconds a client should wait before retrying (sent as Retry-After).
  retryAfter?: number;
  constructor(
    status: number,
    code: string,
    message?: string,
    fieldErrors?: Record<string, string>,
  ) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function toResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    const body: Record<string, unknown> = { ok: false, code: err.code };
    if (err.fieldErrors) body.fieldErrors = err.fieldErrors;
    if (err.message && err.message !== err.code) body.message = err.message;
    const headers =
      err.retryAfter === undefined ? undefined : { "retry-after": String(err.retryAfter) };
    return NextResponse.json(body, { status: err.status, headers });
  }
  console.error("[api] unexpected error:", err instanceof Error ? err.message : String(err));
  return NextResponse.json({ ok: false, code: "server_error" }, { status: 500 });
}
