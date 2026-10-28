import { AppError } from "./errors";

const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

// Sliding one-minute window per key, in memory: per server instance, so on serverless it bounds bursts, not a
// global rate (see agent/known-issues.md).
export function rateLimit(key: string, perMinute: number, now = Date.now()): void {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= perMinute) {
    hits.set(key, recent);
    throw new AppError(429, "rate_limited", "too many requests, try again in a minute");
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) {
    for (const [k, times] of hits) if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
}

export function resetRateLimitsForTests() {
  hits.clear();
}
