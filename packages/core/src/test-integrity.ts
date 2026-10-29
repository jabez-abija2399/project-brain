// FEAT-018: signs that a change games the tests instead of fixing the code. Runs on the user's machine (the CLI's
// session-end hook) on the before/after text of each changed test or test-config file; only file names, test names
// and counts leave it (D-002). Pure: the caller passes the texts.
import { createHash } from "node:crypto";
import { TEST_FILE } from "./receipt";
import {
  type TestCall,
  assertionCount,
  bracketPairs,
  namelessMarkers,
  readSource,
  testCalls,
} from "./test-source";

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
  // How many tests or assertions were removed / skipped, or settings changed.
  count: number;
};

export type FileChange = { path: string; before: string | null; after: string | null };

const MAX_NAMES = 20;

// Test runner configs (vitest, vite, jest, playwright, mocha, cypress) whose settings decide which tests run, and
// package.json (its jest/vitest keys and test scripts).
const TEST_CONFIG =
  /(^|\/)(vitest|vite|jest|playwright|cypress)\.config(\.[\w-]+)?\.([cm]?[jt]s|json)$|(^|\/)\.mocharc(\.\w+)?$|(^|\/)vitest\.workspace\.([cm]?[jt]s|json)$|(^|\/)package\.json$/;
// Sections of a config that do not choose tests (coverage reports, bundling): changes there are not flagged.
const NOT_SELECTION = ["coverage", "optimizeDeps", "build", "server", "preview", "resolve", "css"];
const SELECTION_KEYS =
  /\b(include|exclude|testMatch|testRegex|testPathIgnorePatterns|testPathPattern|testIgnore|testNamePattern|modulePathIgnorePatterns|passWithNoTests|bail|allowOnly|spec|ignore|dir|root|roots|projects|grep|grepInvert)\b/g;

export const isTestFile = (path: string) => TEST_FILE.test(path);
export const isTestConfig = (path: string) => TEST_CONFIG.test(path);

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

// Multiset difference: each name in `take` removes one equal name from `from` (linear, Map-based).
function minus<T>(from: T[], take: T[], key: (t: T) => string): T[] {
  const counts = new Map<string, number>();
  for (const t of take) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
  return from.filter((t) => {
    const n = counts.get(key(t)) ?? 0;
    if (n === 0) return true;
    counts.set(key(t), n - 1);
    return false;
  });
}

function checkTestFile(c: FileChange): IntegrityFlag[] {
  const parse = (text: string) => {
    const src = readSource(text);
    return {
      calls: testCalls(src, text),
      assertions: assertionCount(src),
      nameless: namelessMarkers(src),
    };
  };
  const before = c.before === null ? null : parse(c.before);
  if (c.after === null) {
    return before
      ? [
          {
            kind: "deleted_test_file",
            file: c.path,
            names: before.calls.map((t) => t.name).slice(0, MAX_NAMES),
            count: before.calls.length,
          },
        ]
      : [];
  }
  const after = parse(c.after);
  const flags: IntegrityFlag[] = [];
  if (before) {
    // Tests whose name is gone. A gone name whose body reappears under a new name is a rename (AC-018-04); anything
    // else was deleted, even when a new, different test was added at the same time.
    const tests = (calls: TestCall[]) => calls.filter((t) => t.kind === "test");
    const gone = minus(tests(before.calls), tests(after.calls), (t) => t.name);
    const added = minus(tests(after.calls), tests(before.calls), (t) => t.name);
    const deleted = minus(gone, added, (t) => hash(t.body));
    if (deleted.length > 0) {
      flags.push({
        kind: "deleted_tests",
        file: c.path,
        names: deleted.map((t) => t.name).slice(0, MAX_NAMES),
        count: deleted.length,
      });
    }
  }
  const marked = (calls: TestCall[]) => calls.filter((t) => t.marker !== "");
  const newlyMarked = minus(
    marked(after.calls),
    marked(before?.calls ?? []),
    (t) => `${t.marker}:${t.name}`,
  );
  const nameless = Math.max(0, after.nameless - (before?.nameless ?? 0));
  if (newlyMarked.length + nameless > 0) {
    flags.push({
      kind: "skipped_tests",
      file: c.path,
      names: [
        ...newlyMarked.map((t) => `${t.marker}: ${t.name}`),
        ...(nameless > 0 ? ['skip/only without a test name (ctx.skip, alias, it["only"])'] : []),
      ].slice(0, MAX_NAMES),
      count: newlyMarked.length + nameless,
    });
  }
  if (before) {
    const removed = before.assertions - after.assertions;
    if (removed > 0)
      flags.push({ kind: "removed_assertions", file: c.path, names: [], count: removed });
  }
  return flags;
}

// The config's code with comments and the non-selection sections blanked, whitespace normalised; and the selection
// keys it mentions.
function selectionView(text: string): { view: string; keys: Set<string> } {
  const src = readSource(text);
  const pairs = bracketPairs(src.code);
  const hidden = new Uint8Array(text.length);
  for (const section of NOT_SELECTION) {
    for (const m of src.code.matchAll(new RegExp(`\\b${section}\\s*:\\s*\\{`, "g"))) {
      const open = (m.index ?? 0) + m[0].length - 1;
      const end = pairs[open] ?? -1;
      if (end === -1) continue;
      hidden.fill(1, m.index ?? 0, end);
    }
  }
  // Comments are out, string contents stay (an exclude glob is a string), hidden sections are blanked.
  const view = [...src.noComments].map((ch, k) => (hidden[k] ? " " : ch)).join("");
  return {
    view: view.replace(/\s+/g, " ").trim(),
    keys: new Set([...view.matchAll(SELECTION_KEYS)].map((m) => m[1] ?? "")),
  };
}

function checkPackageJson(c: FileChange): IntegrityFlag[] {
  const pick = (text: string | null) => {
    try {
      const pkg = JSON.parse(text ?? "{}") as {
        jest?: unknown;
        vitest?: unknown;
        scripts?: Record<string, unknown>;
      };
      const scripts = Object.entries(pkg.scripts ?? {}).filter(
        ([k, v]) => /^test/.test(k) || /\b(vitest|jest|playwright|mocha|cypress)\b/.test(String(v)),
      );
      return {
        jest: JSON.stringify(pkg.jest ?? null),
        vitest: JSON.stringify(pkg.vitest ?? null),
        scripts: JSON.stringify(scripts),
      };
    } catch {
      return null;
    }
  };
  const [a, b] = [pick(c.before), pick(c.after)];
  if (!a || !b) return [];
  const names = (["jest", "vitest", "scripts"] as const).filter((k) => a[k] !== b[k]);
  return names.length > 0
    ? [{ kind: "test_config_changed", file: c.path, names: [...names], count: names.length }]
    : [];
}

function checkConfig(c: FileChange): IntegrityFlag[] {
  if (/(^|\/)package\.json$/.test(c.path)) return checkPackageJson(c);
  const [a, b] = [selectionView(c.before ?? ""), selectionView(c.after ?? "")];
  if (a.view === b.view) return [];
  // Keys added or removed name the change; a changed value of a key that stays is reported as "settings".
  const keys = [...b.keys]
    .filter((k) => !a.keys.has(k))
    .concat([...a.keys].filter((k) => !b.keys.has(k)));
  const names = keys.length > 0 ? keys.slice(0, MAX_NAMES) : ["settings"];
  return [{ kind: "test_config_changed", file: c.path, names, count: names.length }];
}

// A deleted test file whose tests reappear in an added one is a move, compared as one file.
function pairMoves(changes: FileChange[]): FileChange[] {
  const names = (text: string) =>
    testCalls(readSource(text), text)
      .map((t) => t.name)
      .sort()
      .join("\n");
  const added = changes.filter((c) => c.before === null && c.after !== null && isTestFile(c.path));
  const used = new Set<FileChange>();
  const out: FileChange[] = [];
  for (const c of changes) {
    if (used.has(c)) continue;
    if (c.after === null && c.before !== null && isTestFile(c.path)) {
      const key = names(c.before);
      const twin = added.find((a) => !used.has(a) && names(a.after ?? "") === key);
      if (twin) {
        used.add(twin);
        out.push({ path: twin.path, before: c.before, after: twin.after });
        continue;
      }
    }
    out.push(c);
  }
  return out.filter((c) => !used.has(c));
}

/** Every integrity flag for a session's changed files. Files that are neither tests nor test config are ignored. */
export function checkTestIntegrity(changes: FileChange[]): IntegrityFlag[] {
  return pairMoves(changes).flatMap((c) =>
    isTestFile(c.path) ? checkTestFile(c) : isTestConfig(c.path) ? checkConfig(c) : [],
  );
}
