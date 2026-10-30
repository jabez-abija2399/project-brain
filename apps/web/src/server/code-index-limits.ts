import type { StorageCaps } from "@brain/db";

export const MAX_BATCH_FILES = 200;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
// One summarize request makes at most this many AI calls (~10 calls at a time of 4 = a few seconds); the CLI
// calls again while some are left.
export const SUMMARIZE_MAX_CALLS = 40;
// M2: summarize reads the project's components this many at a time and keeps only the few it will send.
export const SUMMARIZE_PAGE = 1000;
export const INDEX_REQUESTS_PER_MINUTE = 60;
// FEAT-006: import paths per uploaded file (a file with more is a generated barrel; it is cut, not rejected by the CLI).
export const MAX_IMPORTS_PER_FILE = 500;
// KI-023: AI calls per project per UTC day; AI_CALLS_PER_PROJECT_PER_DAY overrides it (a positive integer).
export const DEFAULT_AI_CALLS_PER_DAY = 2000;
// M2: stored files and symbols per project; INDEX_MAX_FILES_PER_PROJECT / INDEX_MAX_SYMBOLS_PER_PROJECT override them.
export const DEFAULT_MAX_FILES_PER_PROJECT = 10_000;
export const DEFAULT_MAX_SYMBOLS_PER_PROJECT = 100_000;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : 0;
  return n > 0 ? n : fallback;
}

export function dailyAiBudget(env: Record<string, string | undefined> = process.env): number {
  return positiveInt(env.AI_CALLS_PER_PROJECT_PER_DAY, DEFAULT_AI_CALLS_PER_DAY);
}

// Captured requests stored per project per day (D-024), so a token cannot fill the database once the AI budget is used.
export const DEFAULT_REQUEST_CAPTURES_PER_DAY = 500;

export function dailyCaptureCap(env: Record<string, string | undefined> = process.env): number {
  return positiveInt(env.REQUEST_CAPTURES_PER_PROJECT_PER_DAY, DEFAULT_REQUEST_CAPTURES_PER_DAY);
}

export function projectStorageCaps(
  env: Record<string, string | undefined> = process.env,
): StorageCaps {
  return {
    files: positiveInt(env.INDEX_MAX_FILES_PER_PROJECT, DEFAULT_MAX_FILES_PER_PROJECT),
    symbols: positiveInt(env.INDEX_MAX_SYMBOLS_PER_PROJECT, DEFAULT_MAX_SYMBOLS_PER_PROJECT),
  };
}
