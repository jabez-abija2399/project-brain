// Real-test B (2026-11-01): a change the user explicitly asked for (for example "add .skip to the first test in
// src/lib/permissions.test.ts") is still listed on the receipt, but labelled "You asked for this" instead of shown as
// an alarm. Deterministic and conservative: the request must name the file AND ask for that kind of change.

// What a request must say for each test check to count as asked for.
const ASKED_KIND: Record<string, RegExp> = {
  skipped_tests: /(\.skip\b|\.only\b|\bskip|\bxit\b|\bxdescribe\b|\bdisable|\bfocus)/i,
  deleted_tests: /\b(delete|remove|drop)\b/i,
  deleted_test_file: /\b(delete|remove|drop)\b/i,
  removed_assertions: /\b(delete|remove|drop)\b[^.]*\b(assert|assertions?|expect)/i,
  test_config_changed: /\b(config|configuration|setup)\b/i,
};

// Path-shaped words in a request ("src/lib/permissions.test.ts", "permissions.test.ts", "package.json").
const PATHS = /[\w@~.-]+(?:\/[\w@~.-]+)*\.[A-Za-z0-9]{1,8}\b/g;

/** The request names this file: by its full path, or by a trailing part of it ("permissions.test.ts"). */
export function namesFile(request: string, file: string): boolean {
  const target = file.replace(/^\.\//, "").toLowerCase();
  if (target === "") return false;
  for (const word of request.toLowerCase().match(PATHS) ?? []) {
    const w = word.replace(/^\.\//, "").replace(/[.]+$/, "");
    if (w === target || target.endsWith(`/${w}`)) return true;
  }
  return false;
}

/** A test check (kind + file) that one of the requests asked for. */
export function askedForCheck(requests: string[], check: { kind: string; file: string }): boolean {
  const kind = ASKED_KIND[check.kind];
  return !!kind && requests.some((r) => kind.test(r) && namesFile(r, check.file));
}

/** A finding or out-of-scope file in a file that one of the requests asked to create or change. */
export function askedForFile(requests: string[], file: string): boolean {
  return requests.some((r) => namesFile(r, file));
}
