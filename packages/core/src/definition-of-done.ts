// Roadmap Phase 5c: a definition of done handed to the agent the moment a request is captured. Deterministic and
// without AI: the request is matched to a feature by the words of the feature's name, and the note lists that
// feature's owner-approved criteria, must-never rules, protected paths and the tests that prove it. Project data, never
// instructions from the server: every line is one plain, masked line and the whole note has a fixed budget.
import { maskPath, maskSecretsIn } from "./mask";
import { plainText } from "./text";

export const DONE_NOTE_LIMIT = 1_500;
const MAX_LINE = 160;
const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "page",
  "app",
  "new",
  "add",
  "fix",
  "make",
  "this",
  "that",
  "from",
  "into",
  "feature",
]);

const words = (text: string) =>
  (
    plainText(text)
      .normalize("NFC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  ).filter((w) => w.length >= 3 && !STOP.has(w));

/**
 * The feature a request names: every significant word of the feature's name appears in the request (a plural "s" is
 * allowed). The feature with the most such words wins; a tie, or no feature, is no match (never a guess).
 */
export function matchFeatureByWords<F extends { id: string; name: string }>(
  request: string,
  features: F[],
): F | null {
  const said = new Set(words(request).slice(0, 2_000));
  const has = (w: string) =>
    said.has(w) || said.has(`${w}s`) || (w.endsWith("s") && said.has(w.slice(0, -1)));
  let best: F | null = null;
  let bestScore = 0;
  let tie = false;
  for (const f of features) {
    const need = [...new Set(words(f.name))];
    if (need.length === 0) continue;
    // Security review (Phase 5c): a one-word name ("api", "users") needs the exact word and at least 4 letters, so a
    // common word does not hand the agent an unrelated feature's rules.
    if (need.length === 1) {
      const [only] = need;
      if (!only || only.length < 4 || !said.has(only)) continue;
    } else if (!need.every(has)) continue;
    if (need.length > bestScore) {
      best = f;
      bestScore = need.length;
      tie = false;
    } else if (need.length === bestScore) tie = true;
  }
  return tie ? null : best;
}

export type DoneNoteInput = {
  feature: string;
  criteria: { text: string; kind: string }[];
  protectedPaths: string[];
  tests: { path: string; testName?: string | null }[];
};

const line = (text: string) => {
  const t = maskSecretsIn(plainText(text));
  return t.length > MAX_LINE ? `${t.slice(0, MAX_LINE - 1)}…` : t;
};

/** The note, or null when the feature has nothing to say (no criteria, rules, protected paths or tests). */
export function definitionOfDone(input: DoneNoteInput): string | null {
  const guards = input.criteria.filter((c) => c.kind === "must_never" || c.kind === "security");
  const done = input.criteria.filter((c) => c.kind !== "must_never" && c.kind !== "security");
  const sections: [string, string[]][] = [
    ["Done when", done.slice(0, 5).map((c) => line(c.text))],
    ["Must never", guards.slice(0, 3).map((c) => line(c.text))],
    [
      "Do not change (protected by the owner)",
      input.protectedPaths.slice(0, 5).map((p) => line(maskPath(p))),
    ],
    [
      "Tests that prove it",
      input.tests
        .slice(0, 5)
        .map((t) => line(`${maskPath(t.path)}${t.testName ? `: ${t.testName}` : ""}`)),
    ],
  ];
  if (sections.every(([, items]) => items.length === 0)) return null;
  // The name is shown without double quotes, so it cannot close the quotes and read as text of its own.
  const name = line(input.feature).replace(/"/g, "'");
  const out = [`Codeceipt (project data): definition of done for "${name}".`];
  for (const [title, items] of sections) {
    if (items.length === 0) continue;
    const next = [`${title}:`, ...items.map((i) => `- ${i}`)];
    if ([...out, ...next].join("\n").length > DONE_NOTE_LIMIT) break;
    out.push(...next);
  }
  return out.join("\n");
}
