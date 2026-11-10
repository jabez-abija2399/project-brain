import { newLines } from "./guard";
import { TEST_FILE } from "./receipt";
import { safePath } from "./fix-prompt";

// Roadmap Phase 7: `codeceipt review`. The build checklist (docs/build-checklist.md) as a rule pack: which of its
// eight rules a change touches, chosen from the changed paths and added lines only (no AI, nothing sent anywhere),
// plus maintainability flags (long files, large changes). Advisory: it says what to check, it never blocks.
// Paths are shown the way Guard shows them (safePath): one line, no invisible characters, secrets masked, capped.

export type ReviewFile = { path: string; before: string | null; after: string | null };
export type ReviewRule = {
  id: number;
  title: string;
  check: string;
};
export type ReviewItem = ReviewRule & { files: string[] };
export type MaintainabilityFlag = {
  kind: "long_file" | "large_change" | "many_files";
  file?: string;
  what: string;
};

export const LONG_FILE_LINES = 300;
export const LARGE_CHANGE_LINES = 400;
export const MANY_FILES = 20;
const MAX_FILES_PER_ITEM = 5;
const MAX_FLAGS = 20;

// Titles match the headings of docs/build-checklist.md (a test keeps them in step).
export const REVIEW_RULES: readonly ReviewRule[] = [
  {
    id: 1,
    title: "Every query and route is scoped by project, tested with a second project.",
    check:
      "Check that each query filters by project, and add a test where a second project's token or id is refused.",
  },
  {
    id: 2,
    title: 'Fail closed: when unsure, the answer is "unknown" or a refusal, never "safe".',
    check:
      "Check what happens on bad, missing or unreadable input: it must refuse or say unknown, never pass.",
  },
  {
    id: 3,
    title: "Secrets are masked in output, errors, logs and AI prompts.",
    check:
      "Check that no token, key or password reaches output, errors or logs; fake secrets in tests are built at run time.",
  },
  {
    id: 4,
    title: "Every input, list, loop and AI call has a cap.",
    check:
      "Check that every list, loop, read and request body has a limit, and test what happens just above it.",
  },
  {
    id: 5,
    title: "Test with realistic real-world inputs, not only tidy fixtures.",
    check:
      "Add a test with messy real input: odd file names, other layouts, empty and very large values.",
  },
  {
    id: 6,
    title: "User choices survive re-runs and re-indexes.",
    check:
      "Check that running it again keeps what the user chose by hand instead of overwriting it.",
  },
  {
    id: 7,
    title: "Concurrent requests cannot break limits or duplicate data.",
    check:
      "Check what two requests at once do: limits and unique rows must hold (a lock, a unique key or one statement).",
  },
  {
    id: 8,
    title: "No tests that depend on timing or machine load.",
    check:
      "Replace real waiting or clock reads in tests with an injected clock or sleep, or give slow tests a set limit.",
  },
];

const ENTRY =
  /(^|\/)(api|routes?|server|handlers?|actions?|middleware)\/|(^|\/)route\.[cm]?[jt]sx?$/;
const DATA = /(^|\/)(repos?|db|database|schema|migrations?|supabase)\/|\.sql$/;
const INPUT = /(pars|read|scan|import|index|upload|webhook)/i;
const RERUN = /(index|sync|import|migrat|upsert|seed)/i;
const SECRET_WORDS =
  /secret|token|passw|api[_-]?key|authorization|credential|console\.(log|error)|logger\./i;
const LOOP_WORDS =
  /\b(for|while)\s*\(|\.(map|forEach|flatMap|reduce)\(|\bfetch\(|readFile|findMany|\.select\(/;
const FAIL_WORDS = /\bcatch\b|\?\?|\|\||default:|else\s*\{|return (true|null)\b/;
const WRITE_WORDS =
  /\binsert\b|onConflict|ON CONFLICT|upsert|transaction|advisory|\bupdate\(|INSERT INTO/i;
const TIMING_WORDS = /setTimeout|Date\.now|performance\.now|new Date\(\)|\bsleep\(|toBeLessThan\(/;

const NOT_CODE = /\.(md|mdx|txt|png|jpe?g|gif|svg|ico|webp|lock)$/i;
const lines = (text: string | null) => (text === null ? [] : text.split("\n"));
function addedText(f: ReviewFile): string[] {
  if (f.after === null) return [];
  const all = lines(f.after);
  return [...newLines(f.before, f.after)].map((n) => all[n - 1] ?? "");
}

/** The build-checklist rules this change touches, each with the files that touch it (at most 5 named). */
export function reviewChecklist(files: ReviewFile[]): ReviewItem[] {
  const hits = new Map<number, string[]>();
  const hit = (id: number, path: string) => {
    const list = hits.get(id) ?? [];
    if (!list.includes(path)) list.push(path);
    hits.set(id, list);
  };
  for (const f of files) {
    // Deleted files and documents, images and lockfiles: nothing for these rules to check.
    if (f.after === null || NOT_CODE.test(f.path)) continue;
    const path = safePath(f.path);
    const added = addedText(f);
    const any = (re: RegExp) => added.some((l) => re.test(l));
    const test = TEST_FILE.test(f.path);
    if (test) {
      if (any(TIMING_WORDS)) hit(8, path);
      continue;
    }
    const entry = ENTRY.test(f.path);
    const data = DATA.test(f.path);
    if (entry || data) hit(1, path);
    if ((entry || INPUT.test(f.path)) && any(FAIL_WORDS)) hit(2, path);
    if (any(SECRET_WORDS)) hit(3, path);
    if ((entry || data || INPUT.test(f.path)) && any(LOOP_WORDS)) hit(4, path);
    if (INPUT.test(f.path)) hit(5, path);
    if (RERUN.test(f.path) && (data || any(WRITE_WORDS))) hit(6, path);
    if (/\.sql$/.test(f.path) || ((entry || data) && any(WRITE_WORDS))) hit(7, path);
  }
  return REVIEW_RULES.filter((r) => hits.has(r.id)).map((r) => ({
    ...r,
    files: (hits.get(r.id) ?? []).slice(0, MAX_FILES_PER_ITEM),
  }));
}

/** Long files and large changes: deterministic, from line counts only. */
export function maintainabilityFlags(files: ReviewFile[]): MaintainabilityFlag[] {
  const flags: MaintainabilityFlag[] = [];
  let added = 0;
  let changed = 0;
  for (const f of files) {
    changed += 1;
    if (f.after === null) continue;
    added += newLines(f.before, f.after).size;
    const now = lines(f.after).length;
    const was = lines(f.before).length;
    // Only files this change made long or longer: an old long file left alone is not this change's flag.
    if (now > LONG_FILE_LINES && now > was && !/\.(json|lock|sql|md|snap)$/.test(f.path)) {
      flags.push({
        kind: "long_file",
        file: safePath(f.path),
        what: `${now} lines (over ${LONG_FILE_LINES}): split it into smaller files with one job each.`,
      });
    }
  }
  const long = flags.slice(0, MAX_FLAGS - 2);
  if (added > LARGE_CHANGE_LINES) {
    long.push({
      kind: "large_change",
      what: `${added} new lines (over ${LARGE_CHANGE_LINES}): review it in parts, or split it into smaller changes.`,
    });
  }
  if (changed > MANY_FILES) {
    long.push({
      kind: "many_files",
      what: `${changed} files changed (over ${MANY_FILES}): check that every file belongs to this change.`,
    });
  }
  return long;
}
