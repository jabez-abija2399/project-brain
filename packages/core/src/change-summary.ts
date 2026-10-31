// D-025: a code-free summary of what changed in one file, computed on the user's machine from git's diff (or from a new
// file's text). Only counts, symbol names and places leave the machine, never a line of source (D-002). Pure.
import { maskSecretsIn } from "./mask";

export type ChangeSummary = {
  path: string;
  added: number;
  removed: number;
  // Every changed line is a comment or blank.
  comment_only: boolean;
  imports_changed: boolean;
  symbols_added: string[];
  symbols_removed: string[];
  symbols_changed: string[];
  // "top of file", "end of file", "line N", "lines N-M", "new file", "deleted file", "binary file", "N more places".
  where: string[];
};

export const MAX_SUMMARY_SYMBOLS = 20;
const MAX_PLACES = 5;
const MAX_COUNT = 1_000_000;
const TOP_LINES = 3;

// A top-level declaration's name (no indentation, so locals inside a function are not symbols): functions, classes,
// types, variables (JS/TS), def/class (Python), CREATE ... (SQL).
const DECL =
  /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var|def)\s+([A-Za-z_$][\w$]*)|^create\s+(?:or\s+replace\s+)?(?:table|view|function|policy|index)\s+(?:if\s+not\s+exists\s+)?"?([A-Za-z_][\w.]*)/i;
const NAME = /^[A-Za-z_$][\w$.]{0,99}$/;
const COMMENT = /^(\/\/|\/\*|\*|\*\/|#(?!include|!)|--|<!--|-->|\{\s*\/\*)/;
const IMPORT =
  /^\s*(import\b|export\s+(\*|\{[^}]*\})\s+from\b|from\s+\S+\s+import\b)|\brequire\(\s*["'`]/;

function nameOf(line: string): string | null {
  const m = DECL.exec(line);
  const name = m?.[1] ?? m?.[2] ?? null;
  return name && NAME.test(name) ? name : null;
}

// Names are identifiers by the pattern above; anything secret-shaped is masked as well.
const cleanNames = (names: Iterable<string>) =>
  [...new Set([...names].map((n) => maskSecretsIn(n)))].slice(0, MAX_SUMMARY_SYMBOLS);

const commentOnly = (lines: string[]) => {
  const real = lines.map((l) => l.trim()).filter((l) => l !== "");
  return real.length > 0 && real.every((l) => COMMENT.test(l));
};

function places(hunks: { start: number; count: number }[], total: number): string[] {
  const out: string[] = [];
  for (const h of hunks) {
    const end = h.start + Math.max(h.count, 1) - 1;
    const place =
      h.start <= TOP_LINES && h.count > 0
        ? "top of file"
        : h.count > 1
          ? `lines ${h.start}-${end}`
          : `line ${h.start}`;
    if (!out.includes(place)) out.push(place);
  }
  const last = hunks.at(-1);
  if (last && total > 0 && last.count > 0 && last.start + last.count - 1 >= total) {
    if (!out.includes("end of file")) out.push("end of file");
  }
  if (out.length <= MAX_PLACES) return out;
  return [...out.slice(0, MAX_PLACES), `${out.length - MAX_PLACES} more places`];
}

function summary(
  path: string,
  plus: string[],
  minus: string[],
  inside: Set<string>,
  where: string[],
): ChangeSummary {
  const addedNames = new Set(plus.map(nameOf).filter((n): n is string => n !== null));
  const removedNames = new Set(minus.map(nameOf).filter((n): n is string => n !== null));
  const changed = new Set<string>();
  for (const n of addedNames) if (removedNames.has(n)) changed.add(n);
  for (const n of inside) if (!addedNames.has(n) && !removedNames.has(n)) changed.add(n);
  return {
    path,
    added: Math.min(plus.length, MAX_COUNT),
    removed: Math.min(minus.length, MAX_COUNT),
    comment_only: commentOnly([...plus, ...minus]),
    imports_changed: [...plus, ...minus].some((l) => IMPORT.test(l)),
    symbols_added: cleanNames([...addedNames].filter((n) => !changed.has(n))),
    symbols_removed: cleanNames([...removedNames].filter((n) => !changed.has(n))),
    symbols_changed: cleanNames(changed),
    where,
  };
}

/** Summarizes `git diff -U0` output for one file; `total` is the file's line count now (0 when deleted). */
export function summarizeDiff(path: string, diff: string, total: number): ChangeSummary {
  const plus: string[] = [];
  const minus: string[] = [];
  const inside = new Set<string>();
  const hunks: { start: number; count: number }[] = [];
  let kind: string | null = null;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (!inHunk) {
      if (line.startsWith("deleted file mode")) kind = "deleted file";
      else if (line.startsWith("new file mode")) kind = "new file";
      else if (line.startsWith("Binary files ") || line === "GIT binary patch")
        kind = "binary file";
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
    if (h) {
      inHunk = true;
      const count = h[4] === undefined ? 1 : Number(h[4]);
      // A pure deletion is placed at the old line (git gives the line before it in the new file).
      hunks.push(count > 0 ? { start: Number(h[3]), count } : { start: Number(h[1]), count: 0 });
      const ctx = nameOf(h[5] ?? "");
      if (ctx) inside.add(ctx);
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) plus.push(line.slice(1));
    else if (line.startsWith("-")) minus.push(line.slice(1));
  }
  if (kind === "binary file") return summary(path, [], [], new Set(), ["binary file"]);
  if (kind) return summary(path, plus, minus, new Set(), [kind]);
  return summary(path, plus, minus, inside, places(hunks, total));
}

/** A file whose lines are not counted (binary, larger than the scan limit, a symlink): its kind only. */
export function skippedFile(
  path: string,
  kind: "binary file" | "large file" | "symlink",
): ChangeSummary {
  return summary(path, [], [], new Set(), [kind]);
}

/** A file git does not track yet: every line is added. */
export function summarizeNewFile(path: string, text: string): ChangeSummary {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return summary(path, lines, [], new Set(), ["new file"]);
}
