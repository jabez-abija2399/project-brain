import { type BrainDb, aiUsageRepo, rateCountersRepo } from "@brain/db";
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
  const granted = Math.max(0, Math.min(want, limit - (total - want)));
  await recordAi(db, key, granted, now);
  return granted;
}

export async function releaseDaily(db: BrainDb, key: string, n: number, now: Date): Promise<void> {
  if (n <= 0) return;
  await rateCountersRepo.add(db, key, utcDayStart(now), -n);
  await recordAi(db, key, -n, now);
}

// The admin AI usage page (2026-11-01): AI calls granted per project per day, kept after the counters are pruned.
async function recordAi(db: BrainDb, key: string, n: number, now: Date): Promise<void> {
  const m = /^ai:([\w-]{1,64})$/.exec(key);
  if (!m?.[1] || n === 0) return;
  await aiUsageRepo.add(db, m[1], now, n).catch(() => {});
}

export function nextUtcDay(now: Date): Date {
  return new Date(utcDayStart(now).getTime() + DAY_MS);
}
