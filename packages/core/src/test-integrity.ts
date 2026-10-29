// FEAT-018: signs that a change games the tests instead of fixing the code. Runs on the user's machine (the CLI's
// session-end hook) on the before/after text of each changed test or test-config file; only file names, test names
// and counts leave it (D-002). Pure: the caller passes the texts.
import { TEST_FILE } from "./receipt";

export type IntegrityKind =
  | "deleted_test_file"
  | "deleted_tests"
  | "skipped_tests"
  | "removed_assertions"
  | "test_config_changed";

export type IntegrityFlag = {
  kind: IntegrityKind;
  file: string;
  // Test names involved (removed, newly skipped or focused); config keys for test_config_changed.
  names: string[];
  // How many tests or assertions were removed / skipped, or keys changed.
  count: number;
};

export type FileChange = { path: string; before: string | null; after: string | null };

const MAX_NAMES = 20;
const MAX_NAME_CHARS = 200;
// Lines longer than this are not parsed for test names (minified or generated code).
const MAX_LINE_CHARS = 2_000;

// Test runner config files (vitest, vite, jest, playwright, mocha) whose include/exclude decide which tests run.
const TEST_CONFIG =
  /(^|\/)(vitest|vite|jest|playwright)\.config(\.[\w-]+)?\.[cm]?[jt]s$|(^|\/)\.mocharc(\.\w+)?$|(^|\/)vitest\.workspace\.[cm]?[jt]s$/;
const CONFIG_KEYS = [
  "include",
  "exclude",
  "testMatch",
  "testRegex",
  "testPathIgnorePatterns",
  "testIgnore",
  "modulePathIgnorePatterns",
  "passWithNoTests",
  "bail",
  "allowOnly",
  "spec",
  "ignore",
] as const;

export const isTestFile = (path: string) => TEST_FILE.test(path);
export const isTestConfig = (path: string) => TEST_CONFIG.test(path);

type TestCase = { name: string; marker: "" | "skip" | "only" };

// it("name", ...), test.skip('name', ...), xit(`name`, ...), fdescribe("name", ...): one case per call. Line by line,
// so the scan stays linear on any input.
const CALL =
  /(?:^|[^\w.$])(x|f)?(it|test|describe|context|suite)(?:\.(skip|only|todo|concurrent|fails|each\([^)]{0,200}\)))?\s*\(\s*(["'`])((?:\\.|(?!\4)[^\\])*)\4/g;

function testCases(text: string): TestCase[] {
  const out: TestCase[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.length > MAX_LINE_CHARS) continue;
    for (const m of line.matchAll(CALL)) {
      const prefix = m[1];
      const modifier = m[3] ?? "";
      const marker =
        prefix === "x" || modifier === "skip" || modifier === "todo"
          ? "skip"
          : prefix === "f" || modifier === "only"
            ? "only"
            : "";
      out.push({ name: (m[5] ?? "").slice(0, MAX_NAME_CHARS), marker });
    }
  }
  return out;
}

const expects = (text: string) => (text.match(/\bexpect(?:\.soft)?\s*\(/g) ?? []).length;

// Removes one occurrence of each name in `taken` from `from`, so a renamed test is not counted as a removed one.
function minus(from: string[], taken: string[]): string[] {
  const left = [...from];
  for (const t of taken) {
    const i = left.indexOf(t);
    if (i !== -1) left.splice(i, 1);
  }
  return left;
}

// Lines that mention a test-selection key, trimmed; a config change is any difference in them.
function configLines(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.length > MAX_LINE_CHARS) continue;
    for (const key of CONFIG_KEYS) {
      if (new RegExp(`(^|[^\\w])["']?${key}["']?\\s*[:=]`).test(line)) {
        out.set(key, [...(out.get(key) ?? []), line.trim()]);
      }
    }
  }
  return out;
}

function checkTestFile(c: FileChange): IntegrityFlag[] {
  const before = c.before === null ? [] : testCases(c.before);
  const flags: IntegrityFlag[] = [];
  if (c.after === null) {
    if (c.before !== null) {
      flags.push({
        kind: "deleted_test_file",
        file: c.path,
        names: before.map((t) => t.name).slice(0, MAX_NAMES),
        count: before.length,
      });
    }
    return flags;
  }
  const after = testCases(c.after);
  // Fewer cases than before: the names that disappeared are reported (a rename keeps the count, AC-018-04).
  const lost = before.length - after.length;
  if (lost > 0) {
    const gone = minus(
      before.map((t) => t.name),
      after.map((t) => t.name),
    );
    flags.push({
      kind: "deleted_tests",
      file: c.path,
      names: gone.slice(0, MAX_NAMES),
      count: lost,
    });
  }
  // Newly skipped or focused cases (.only silently skips every other test in the file).
  const marked = (list: TestCase[]) =>
    list.filter((t) => t.marker !== "").map((t) => `${t.marker}:${t.name}`);
  const newlyMarked = minus(marked(after), marked(before));
  if (newlyMarked.length > 0) {
    flags.push({
      kind: "skipped_tests",
      file: c.path,
      names: newlyMarked
        .map((m) => m.replace(/^skip:/, "skip: ").replace(/^only:/, "only: "))
        .slice(0, MAX_NAMES),
      count: newlyMarked.length,
    });
  }
  if (c.before !== null) {
    const removed = expects(c.before) - expects(c.after);
    if (removed > 0)
      flags.push({ kind: "removed_assertions", file: c.path, names: [], count: removed });
  }
  return flags;
}

function checkConfig(c: FileChange): IntegrityFlag[] {
  const before = configLines(c.before ?? "");
  const after = configLines(c.after ?? "");
  const changed = CONFIG_KEYS.filter(
    (k) => JSON.stringify(before.get(k) ?? []) !== JSON.stringify(after.get(k) ?? []),
  );
  return changed.length > 0
    ? [{ kind: "test_config_changed", file: c.path, names: [...changed], count: changed.length }]
    : [];
}

/** Every integrity flag for a session's changed files. Files that are neither tests nor test config are ignored. */
export function checkTestIntegrity(changes: FileChange[]): IntegrityFlag[] {
  return changes.flatMap((c) =>
    isTestFile(c.path) ? checkTestFile(c) : isTestConfig(c.path) ? checkConfig(c) : [],
  );
}
