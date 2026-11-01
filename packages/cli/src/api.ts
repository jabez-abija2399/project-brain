import type { CliConfig } from "./config";

export const EXIT = { ok: 0, failure: 1, usage: 2, auth: 3, rejected: 4, server: 5 } as const;

export class CliError extends Error {
  constructor(
    readonly exitCode: number,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// KI-028: on 429 the CLI waits the server's Retry-After (1 to 60 s; 60 when missing or unreadable) and retries.
export const MAX_RETRIES = 5;
const MAX_WAIT_S = 60;
export type RetryOn429 = {
  sleep: (ms: number) => Promise<void>;
  print: (line: string) => void;
};

export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  const value = header?.trim() ?? "";
  let seconds = Number.NaN;
  if (/^\d+$/.test(value)) seconds = Number(value);
  else if (value && Number.isNaN(Number(value))) seconds = (Date.parse(value) - now) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return MAX_WAIT_S;
  return Math.min(MAX_WAIT_S, Math.max(1, Math.ceil(seconds)));
}

// The CLI's own words for a suspension (2026-11-01): the server's text is never printed (it is data, not ours).
export const SUSPENDED_MESSAGE =
  "This project or account is suspended by Codeceipt, so the CLI and MCP do not work. Open the dashboard for details and contact support to restore it.";

function fromStatus(status: number, code: string | undefined): CliError {
  if (status === 403 && code === "suspended") return new CliError(EXIT.auth, SUSPENDED_MESSAGE);
  if (status === 401 || status === 404) {
    return new CliError(
      EXIT.auth,
      "The project token was rejected (revoked on the Account page, or the project was deleted): run `npx codeceipt` in this repo again.",
    );
  }
  if (status === 413 && code === "project_storage_full")
    return new CliError(
      EXIT.rejected,
      "This project is at its storage limit on the server (files or symbols per project), so the upload was not stored.",
    );
  if (status === 413)
    return new CliError(EXIT.rejected, "The server rejected an upload as too large.");
  if (status === 429) return new CliError(EXIT.server, "Too many requests: try again in a minute.");
  if (status >= 500)
    return new CliError(EXIT.server, `The server failed (${status}). Try again later.`);
  return new CliError(
    EXIT.failure,
    `The server rejected the request (${status}${code ? ` ${code}` : ""}).`,
  );
}

// Answers larger than this are not read into memory (the API's answers are a few KB).
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** The body as text, or null when it is larger than max bytes (the stream is cancelled, not drained). */
export async function readCapped(res: Response, max: number): Promise<string | null> {
  if (Number(res.headers.get("content-length") ?? "0") > max || !res.body) {
    await res.body?.cancel().catch(() => {});
    return res.body ? null : "";
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// The token goes only in the Authorization header; error messages never include it or a response body.
export async function request<T>(
  fetchImpl: Fetch,
  config: Pick<CliConfig, "apiUrl" | "token">,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  retry?: RetryOn429,
): Promise<T> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await send(fetchImpl, config, method, path, body);
    if (res.status !== 429 || !retry || attempt >= MAX_RETRIES) break;
    const seconds = retryAfterSeconds(res.headers.get("retry-after"));
    retry.print(`Rate limit reached, waiting ${seconds} s`);
    await retry.sleep(seconds * 1000);
  }
  let json: ({ code?: string } & T) | null = null;
  try {
    json = JSON.parse((await readCapped(res, MAX_RESPONSE_BYTES)) ?? "null");
  } catch {}
  if (!res.ok || json === null) throw fromStatus(res.status, json?.code);
  return json;
}

async function send(
  fetchImpl: Fetch,
  config: Pick<CliConfig, "apiUrl" | "token">,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Response> {
  try {
    return await fetchImpl(`${config.apiUrl.replace(/\/+$/, "")}${path}`, {
      method,
      // The API never redirects; following one could hand the token to another host.
      redirect: "error",
      headers: {
        authorization: `Bearer ${config.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new CliError(EXIT.server, `Cannot reach ${config.apiUrl}.`);
  }
}
