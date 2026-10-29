import {
  type PackageCheck,
  type RegistryAnswer,
  assessPackage,
  errorType,
  isValidPackageName,
  summarizePackument,
} from "@brain/core";

// FEAT-014: reads one package document from the public npm registry. https only, no redirects, a timeout and a size
// cap; anything else (network error, 5xx, oversized, malformed) is "unreachable" and never throws.
const REGISTRY = "https://registry.npmjs.org";
// The full document is the only one with publish times; `next` is ~31 MB (measured 2026-10-29).
export const MAX_REGISTRY_BYTES = 40 * 1024 * 1024;
export const REGISTRY_TIMEOUT_MS = 8_000;
// Short cache per package (summaries only), bounded so it cannot grow without limit.
const CACHE_TTL_MS = 10 * 60_000;
// A failed read is cached briefly, so an oversized or broken document is not downloaded on every call.
const UNREACHABLE_TTL_MS = 60_000;
const CACHE_MAX = 200;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
let fetchImpl: Fetch = (url, init) => fetch(url, init);
let timeoutMs = REGISTRY_TIMEOUT_MS;
let maxBytes = MAX_REGISTRY_BYTES;
const cache = new Map<string, { at: number; answer: RegistryAnswer }>();
// Parallel misses for the same name share one download.
const inFlight = new Map<string, Promise<RegistryAnswer>>();

// Tests replace the network (registry calls are mocked) and can shorten the timeout or size cap. Clears the cache.
export function setRegistryFetchForTests(
  f: Fetch | null,
  options: { timeoutMs?: number; maxBytes?: number } = {},
) {
  fetchImpl = f ?? ((url, init) => fetch(url, init));
  timeoutMs = options.timeoutMs ?? REGISTRY_TIMEOUT_MS;
  inFlight.clear();
  maxBytes = options.maxBytes ?? MAX_REGISTRY_BYTES;
  cache.clear();
}

// The URL for a validated name; a scoped name keeps its @ and encodes the slash, as the registry expects.
export function registryUrl(name: string): string {
  if (!isValidPackageName(name)) throw new Error("invalid package name");
  const url = new URL(`${REGISTRY}/${encodeURIComponent(name).replace(/^%40/, "@")}`);
  if (url.origin !== REGISTRY || url.pathname.slice(1).includes("/")) {
    throw new Error("invalid package name");
  }
  return url.href;
}

async function readCapped(res: Response, signal: AbortSignal): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes || !res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    // The timeout covers a stalled body too, whatever the fetch implementation does with the signal.
    signal.throwIfAborted();
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchAnswer(name: string): Promise<RegistryAnswer> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetchImpl(registryUrl(name), {
      headers: { accept: "application/json" },
      redirect: "error",
      signal,
    });
    if (res.status === 404 || res.status === 410) {
      await res.body?.cancel().catch(() => {});
      return "not_found";
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return "unreachable";
    }
    const text = await readCapped(res, signal);
    if (text === null) return "unreachable";
    const doc: unknown = JSON.parse(text);
    // An unpublished package keeps a document with time.unpublished and no versions.
    const time = (doc as { time?: { unpublished?: unknown } } | null)?.time;
    if (time && typeof time === "object" && time.unpublished) return "not_found";
    return summarizePackument(doc, name) ?? "unreachable";
  } catch (err) {
    console.warn("[registry]", JSON.stringify({ error: errorType(err) }));
    return "unreachable";
  }
}

async function registryAnswer(name: string, now: Date): Promise<RegistryAnswer> {
  const hit = cache.get(name);
  const ttl = hit?.answer === "unreachable" ? UNREACHABLE_TTL_MS : CACHE_TTL_MS;
  if (hit && now.getTime() - hit.at < ttl) return hit.answer;
  const pending = inFlight.get(name);
  if (pending) return pending;
  const request = fetchAnswer(name).finally(() => inFlight.delete(name));
  inFlight.set(name, request);
  const answer = await request;
  cache.delete(name);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(name, { at: now.getTime(), answer });
  return answer;
}

/** check_package for a validated name (and optional exact version). Never throws. */
export async function lookupPackage(
  name: string,
  version: string | null,
  now = new Date(),
): Promise<PackageCheck> {
  return assessPackage(name, await registryAnswer(name, now), version, now);
}
