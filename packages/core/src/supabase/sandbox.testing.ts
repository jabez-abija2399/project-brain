import { createPgliteSandbox } from "@brain/sandbox";
import { readSupabaseMigrations } from "./reader";
import type { SupabaseReadResult } from "./types";

// Tests only. Every read starts a PGlite child (~4-8 s, ~600 MB), so each test file reads a fixture directory once.
export const testSandbox = createPgliteSandbox();
const cache = new Map<string, Promise<SupabaseReadResult>>();

export function readFixture(dir: string): Promise<SupabaseReadResult> {
  let result = cache.get(dir);
  if (!result) {
    result = readSupabaseMigrations(dir, testSandbox);
    cache.set(dir, result);
  }
  return result;
}
