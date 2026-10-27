import { createPgliteSandbox } from "@brain/sandbox";
import { readSupabaseMigrations } from "./reader";
import type { SupabaseReadResult } from "./types";

// Tests only. Every read starts a PGlite child (~4-8 s, ~600 MB), so each test file reads a fixture directory once.
// Tests that do not check the time limit get 120 s, so a cold start on a loaded host is not cut short (KI-016).
export const TEST_TIME_LIMIT_MS = 120_000;
export const testSandbox = createPgliteSandbox({ timeLimitMs: TEST_TIME_LIMIT_MS });
const cache = new Map<string, Promise<SupabaseReadResult>>();

export function readFixture(dir: string): Promise<SupabaseReadResult> {
  let result = cache.get(dir);
  if (!result) {
    result = readSupabaseMigrations(dir, testSandbox);
    cache.set(dir, result);
  }
  return result;
}
