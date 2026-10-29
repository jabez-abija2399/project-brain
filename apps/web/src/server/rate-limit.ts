import { type BrainDb, rateCountersRepo } from "@brain/db";
import { AppError } from "./errors";

const MINUTE_MS = 60_000;
// MCP tool calls per minute, per token and per project (so extra tokens do not multiply it). A batch request counts
// each call, and each registry check a receipt makes counts as one call (FEAT-014).
export const MCP_CALLS_PER_MINUTE = 300;
const DAY_MS = 24 * 60 * MINUTE_MS;

// Fixed one-minute window per key in the Postgres counter table (D-010), so every server instance shares the count.
export async function rateLimit(
  db: BrainDb,
  key: string,
  perMinute: number,
  now = new Date(),
  cost = 1,
): Promise<void> {
  const window = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  const count = await rateCountersRepo.add(db, key, window, cost);
  // The first hit of a key's window also clears windows older than two days (minute and daily counters).
  if (count === cost) await rateCountersRepo.prune(db, new Date(now.getTime() - 2 * DAY_MS));
  if (count > perMinute) {
    const err = new AppError(429, "rate_limited", "too many requests, try again in a minute");
    // KI-028: the seconds until this window ends, so the CLI waits no longer than it must.
    err.retryAfter = Math.max(1, Math.ceil((window.getTime() + MINUTE_MS - now.getTime()) / 1000));
    throw err;
  }
}

export function utcDayStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
}

// Reserves up to `want` units of a daily budget (UTC day) and returns how many were granted; give back unused ones
// with releaseDaily. Reservations are atomic, so parallel requests never grant more than the limit together.
export async function reserveDaily(
  db: BrainDb,
  key: string,
  limit: number,
  want: number,
  now: Date,
): Promise<number> {
  if (want <= 0) return 0;
  const total = await rateCountersRepo.add(db, key, utcDayStart(now), want);
  return Math.max(0, Math.min(want, limit - (total - want)));
}

export async function releaseDaily(db: BrainDb, key: string, n: number, now: Date): Promise<void> {
  if (n > 0) await rateCountersRepo.add(db, key, utcDayStart(now), -n);
}

export function nextUtcDay(now: Date): Date {
  return new Date(utcDayStart(now).getTime() + DAY_MS);
}
