// Roadmap Phase 5: Codeceipt Guard. Checks a change before it is committed or merged: no weakened tests, no new
// secrets, no hidden or lookalike characters, nothing under a path the owner protected, no package the owner
// disallowed, and no file too large to review. Pure and deterministic: the CLI passes the before/after texts of the
// changed files; every finding names the file (masked), the line when there is one, what is wrong and the exact fix.
// Never the source line or a secret value.
import { boundaryCheck } from "./blueprint/boundary-check";
import { safeDisplay, safePath } from "./fix-prompt";
import { findHiddenChars } from "./hidden-chars";
import { addedDependencies } from "./package-check";
import { scanSecrets } from "./secrets";
import { type FileChange, type IntegrityFlag, checkTestIntegrity } from "./test-integrity";

export const MAX_GUARD_FINDINGS = 100;

export type GuardRule =
  | "test_file_deleted"
  | "tests_deleted"
  | "tests_skipped"
  | "assertions_removed"
  | "test_config_changed"
  | "secret"
  | "hidden_character"
  | "protected_path"
  | "disallowed_dependency"
  | "not_allowed_dependency"
  | "boundaries_incomplete"
  | "file_too_large"
  | "file_unreadable"
  | "too_many_files";

export type GuardFinding = {
  rule: GuardRule;
  file: string;
  line?: number;
  what: string;
  fix: string;
};

export type GuardFile = {
  path: string;
  before: string | null;
  after: string | null;
  /** Bigger than the CLI reads (1 MB): reported, never scanned. */
  tooLarge?: boolean;
  /** Could not be read (a symlink, a folder, a read error): reported, since it was not checked. */
  unreadable?: boolean;
  /** Binary by kind (an image, a font, an archive): not read as text and not reported. */
  binary?: boolean;
};

export type GuardInput = {
  files: GuardFile[];
  /** Every changed path, for the boundaries (defaults to the files' paths). */
  paths?: string[];
  /** How many changed files were not read at all (the CLI reads at most 500). */
  unreadFiles?: number;
  /** Package names this change added (see newPackageNames). */
  dependencies?: string[];
  /** The Blueprint's active boundaries; null or absent when they could not be read. */
  boundaries?: { kind: string; pattern: string }[] | null;
};

/** Line numbers (1-based) of `after` that `before` did not have: each before line is used up once. */
export function newLines(before: string | null, after: string): Set<number> {
  const left = new Map<string, number>();
  for (const line of before === null ? [] : before.split("\n")) {
    left.set(line, (left.get(line) ?? 0) + 1);
  }
  const out = new Set<number>();
  for (const [i, line] of after.split("\n").entries()) {
    const n = left.get(line) ?? 0;
    if (n > 0) left.set(line, n - 1);
    else out.add(i + 1);
  }
  return out;
}

/** Package names `after` adds (or re-points) compared with `before`; nothing when either is not a JSON object. */
export function newPackageNames(before: string | null, after: string | null): string[] {
  if (after === null) return [];
  try {
    return addedDependencies(before, after).map((d) => d.name);
  } catch {
    return [];
  }
}

const names = (f: IntegrityFlag) => {
  const shown = f.names.slice(0, 3).map((n) => `"${safeDisplay(n, 80)}"`);
  return shown.length > 0 ? `: ${shown.join(", ")}${f.names.length > 3 ? ", …" : ""}` : "";
};

function integrityFinding(f: IntegrityFlag): GuardFinding {
  const file = safePath(f.file);
  switch (f.kind) {
    case "deleted_test_file":
      return {
        rule: "test_file_deleted",
        file,
        what: "This test file was deleted.",
        fix: "Restore it, or move its tests elsewhere in the same change. Delete tests only when the owner agrees.",
      };
    case "deleted_tests":
      return {
        rule: "tests_deleted",
        file,
        what: `${f.count} test(s) were removed${names(f)}.`,
        fix: "Put the tests back and fix the code they check instead.",
      };
    case "skipped_tests":
      return {
        rule: "tests_skipped",
        file,
        what: `${f.count} test(s) were newly skipped or focused${names(f)}.`,
        fix: "Remove .skip / .only / .todo / x-prefixes so every test runs again.",
      };
    case "removed_assertions":
      return {
        rule: "assertions_removed",
        file,
        what: `${f.count} assertion(s) were removed from tests that still exist.`,
        fix: "Restore the expect(...) checks; change what they expect only if the requirement changed.",
      };
    default:
      return {
        rule: "test_config_changed",
        file,
        what: `Settings that choose which tests run were changed${names(f)}.`,
        fix: "Undo the change to the test settings, or ask the owner to approve it.",
      };
  }
}

const HIDDEN_WHAT = {
  bidi: "a text-direction control character that makes code read differently from how it runs",
  invisible: "an invisible character",
  tag: "an invisible tag character that can carry hidden text for an AI",
  lookalike: "a letter from another alphabet that looks like a Latin one",
} as const;

const BOUNDARY = {
  protected_path: {
    rule: "protected_path",
    what: (p: string) => `This path is protected by the owner (${p}).`,
    fix: "Undo the change to this file, or ask the owner to allow it in the Blueprint.",
  },
  disallowed_dependency: {
    rule: "disallowed_dependency",
    what: (p: string) => `This package is disallowed by the owner (${p}).`,
    fix: "Remove the package and use an allowed one, or ask the owner to allow it in the Blueprint.",
  },
  not_allowed_dependency: {
    rule: "not_allowed_dependency",
    what: () => "This package is not on the owner's allowed list.",
    fix: "Remove the package, or ask the owner to add it to the allowed list in the Blueprint.",
  },
} as const;

/** Every finding for the change, most serious first, at most MAX_GUARD_FINDINGS. */
export function guardCheck(input: GuardInput): GuardFinding[] {
  const out: GuardFinding[] = [];
  const changes: FileChange[] = input.files
    .filter((f) => !f.tooLarge && !f.unreadable && !f.binary)
    .map((f) => ({ path: f.path, before: f.before, after: f.after }));
  out.push(...checkTestIntegrity(changes).map(integrityFinding));
  const order: GuardRule[] = [
    "test_file_deleted",
    "tests_deleted",
    "tests_skipped",
    "assertions_removed",
    "test_config_changed",
  ];
  out.sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule));
  for (const f of input.files) {
    if (f.tooLarge || f.unreadable || f.binary || f.after === null) continue;
    const added = newLines(f.before, f.after);
    if (added.size === 0) continue;
    for (const s of scanSecrets(f.path, f.after)) {
      if (!added.has(s.line)) continue;
      out.push({
        rule: "secret",
        file: safePath(f.path),
        line: s.line,
        what: `A secret (${s.type}, ${s.masked_value}) was added.`,
        fix: "Remove it from the code, read it from an environment variable instead, and rotate the key if it was ever pushed.",
      });
    }
    for (const h of findHiddenChars(f.after, added)) {
      out.push({
        rule: "hidden_character",
        file: safePath(f.path),
        line: h.line,
        what: `This line has ${HIDDEN_WHAT[h.kind]} (${h.code}).`,
        fix:
          h.kind === "lookalike"
            ? `Retype the word with plain Latin letters (the odd letter is ${h.code}).`
            : `Delete the ${h.code} character; if the text needs it, write it as an escape (\\u${h.code.slice(2)}).`,
      });
    }
  }
  if (input.boundaries && input.boundaries.length > 0) {
    const { hits, complete } = boundaryCheck({
      files: input.paths ?? input.files.map((f) => f.path),
      dependencies: input.dependencies ?? [],
      boundaries: input.boundaries,
    });
    for (const h of hits) {
      const b = BOUNDARY[h.kind];
      out.push({
        rule: b.rule,
        file: safePath(h.subject),
        what: b.what(safeDisplay(h.pattern, 120)),
        fix: b.fix,
      });
    }
    if (!complete) {
      out.push({
        rule: "boundaries_incomplete",
        file: "(this change)",
        what: "The Blueprint's boundaries could not be checked in full (very long paths, or too many to compare).",
        fix: "Shorten the long paths or split the change into smaller commits, then run the guard again.",
      });
    }
  }
  for (const f of input.files) {
    if (!f.tooLarge) continue;
    out.push({
      rule: "file_too_large",
      file: safePath(f.path),
      what: "This file is larger than 1 MB, so nobody can review it in a diff.",
      fix: "Keep generated or binary files out of the repo (add them to .gitignore), or split the file.",
    });
  }
  for (const f of input.files) {
    if (!f.unreadable) continue;
    out.push({
      rule: "file_unreadable",
      file: safePath(f.path),
      what: "This file could not be read (a symlink, a folder or a read error), so it was not checked.",
      fix: "Replace the symlink with the real file, or check the file's permissions, then run the guard again.",
    });
  }
  if ((input.unreadFiles ?? 0) > 0) {
    out.push({
      rule: "too_many_files",
      file: "(this change)",
      what: `${input.unreadFiles} more changed files were not checked (at most 500 are read).`,
      fix: "Split the change into smaller commits so every file is checked.",
    });
  }
  // The "could not check" findings come last but are never cut off by the limit.
  const meta = out.filter((f) => f.rule === "too_many_files" || f.rule === "boundaries_incomplete");
  const rest = out.filter((f) => !meta.includes(f));
  return [...rest.slice(0, MAX_GUARD_FINDINGS - meta.length), ...meta];
}
