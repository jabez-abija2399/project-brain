// Roadmap Phase 10: the claim checker. An agent's final summary says things ("added tests", "all tests pass",
// "updated src/cart.ts", "did not touch the migrations"). This reads that summary on the user's machine and checks each
// claim against what git shows: confirmed, contradicted, or cannot be checked. Deterministic, no AI. The summary's
// text never leaves the machine: a claim is only its kind, a repo path when it names one, and the verdict.

export const CLAIM_KINDS = ["tests_added", "tests_pass", "changed_file", "left_untouched"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export const CLAIM_VERDICTS = ["confirmed", "contradicted", "cannot_check"] as const;
export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];
export type Claim = { kind: ClaimKind; path?: string };
export type CheckedClaim = Claim & { verdict: ClaimVerdict };

export type ClaimEvidence = {
  /** Repo-relative paths the session changed; null when that cannot be known (no git, no start snapshot). */
  changedFiles: string[] | null;
  /** Every file of the repo (tracked, plus the changed ones). A claim's path is only ever one of these. */
  knownFiles: string[];
  /** Test files (code, still present) the session added or changed; null when unknown. */
  testFilesChanged: number | null;
  /** The test report named by the user, if any: counts, and whether it was written during this session. */
  passingBefore: number | null;
  passingAfter: number | null;
  failedAfter: number | null;
  reportFresh: boolean;
  /** Tests deleted, skipped or weakened in this session (the count of such flags). */
  weakenedTests: number;
};

export const MAX_SUMMARY_CHARS = 20_000;
export const MAX_CLAIMS = 20;
const MAX_SENTENCE = 400;
const MAX_PATH = 200;

// A repo path as an agent writes it: at least one slash or a file extension, plain characters only.
const PATH = /(?:^|[\s`'"(])((?:[\w.@-]+\/)+[\w.@-]+|[\w@-]+\.[a-z]{1,5})(?=$|[\s`'"),.:;])/gi;
const CHANGED =
  /\b(updated?|changed?|modif(?:y|ied)|edit(?:ed)?|creat(?:e|ed)|add(?:ed)?|wrote|rewr(?:o|i)te|refactor(?:ed)?|fix(?:ed)?)\b/i;
// "did not touch X", "without changing X", "no changes to X", "left X untouched", "X is unchanged".
const UNTOUCHED =
  /\b(?:did(?: not|n't)|do(?: not|n't)|have(?: not|n't)|has(?: not|n't)|without|never)\s+(?:touch|chang|modif|edit)\w*|\bno changes? to\b|\b(?:untouched|unchanged)\b|\bleft\b[^.]{0,80}\balone\b/i;
const TESTS_ADDED = /\b(add(?:ed)?|wrote|written|creat(?:e|ed)|new)\b[^.]{0,40}\btests?\b/i;
const TESTS_PASS =
  /\b(?:all\s+)?(?:the\s+)?tests?(?:\s+suite)?\s+(?:now\s+|all\s+|still\s+)?(?:are\s+)?(?:pass(?:es|ing|ed)?|green|succeed(?:s|ed)?)\b/i;
const NEGATED = /\b(not|n't|no|never|fail(?:s|ed|ing)?|skipp?ed|couldn't|could not|unable)\b/i;

// A sentence's final dot is not part of the path.
const normal = (path: string) => path.replace(/^\.\//, "").replace(/\\/g, "/").replace(/\.+$/, "");

/** The claims in an agent's final summary (at most 20, each kind and path once). */
export function extractClaims(summary: string): Claim[] {
  const out: Claim[] = [];
  const seen = new Set<string>();
  const add = (c: Claim) => {
    const key = `${c.kind}:${c.path ?? ""}`;
    if (seen.has(key) || out.length >= MAX_CLAIMS) return;
    seen.add(key);
    out.push(c);
  };
  const sentences = summary
    .slice(0, MAX_SUMMARY_CHARS)
    .split(/(?<=[.!?])\s+|\n+/)
    .slice(0, 400);
  for (const raw of sentences) {
    const s = raw.slice(0, MAX_SENTENCE);
    if (s.trim().length === 0) continue;
    const untouched = UNTOUCHED.test(s);
    if (!untouched && TESTS_PASS.test(s) && !NEGATED.test(s)) add({ kind: "tests_pass" });
    if (!untouched && TESTS_ADDED.test(s) && !NEGATED.test(s)) add({ kind: "tests_added" });
    const paths: string[] = [];
    for (const m of s.matchAll(PATH)) {
      const path = normal(m[1] ?? "");
      // Only paths inside the repo: no "." or ".." parts (a claim never names a file outside it).
      if (path.split("/").some((part) => part === "" || part === "." || part === "..")) continue;
      if (path.length > 0 && path.length <= MAX_PATH) paths.push(path);
    }
    const changedVerb = CHANGED.test(s);
    // "Fixed a.ts without changing b.ts": which file was left alone cannot be told from the sentence, so neither
    // is claimed (security review: an honest claim must not show as contradicted).
    if (untouched && changedVerb && paths.length > 1) continue;
    for (const path of paths) {
      if (untouched) add({ kind: "left_untouched", path });
      else if (changedVerb) add({ kind: "changed_file", path });
    }
  }
  return out;
}

/**
 * The repo file or folder a claimed path names, or null. Security review: a "path" read from the agent's message
 * could be any words with a slash or a dot (a key, an email, a date), so it is used only to look up a real path of
 * this repo, and that real path is what the claim carries. Exact file, exact folder, or one unique file ending.
 */
function resolve(claimed: string, known: Set<string>, list: string[]): string | null {
  if (known.has(claimed)) return claimed;
  if (list.some((f) => f.startsWith(`${claimed}/`))) return claimed;
  const endings = list.filter((f) => f.endsWith(`/${claimed}`));
  // "page.tsx" in a repo with many: which one is meant cannot be told.
  return endings.length === 1 ? (endings[0] as string) : null;
}

/**
 * Each claim against the evidence. Fail closed: without evidence the verdict is "cannot check", never "confirmed".
 * A file claim whose path is not a file or folder of this repo is dropped (nothing of the agent's words is kept).
 */
export function checkClaims(claims: Claim[], evidence: ClaimEvidence): CheckedClaim[] {
  const changed = evidence.changedFiles?.map(normal) ?? null;
  const list = [...new Set([...evidence.knownFiles.map(normal), ...(changed ?? [])])];
  const known = new Set(list);
  const out: CheckedClaim[] = [];
  for (const c of claims.slice(0, MAX_CLAIMS)) {
    if (c.kind === "tests_added") {
      const n = evidence.testFilesChanged;
      out.push({
        kind: c.kind,
        verdict: n === null ? "cannot_check" : n > 0 ? "confirmed" : "contradicted",
      });
      continue;
    }
    if (c.kind === "tests_pass") {
      const { passingBefore: before, passingAfter: after, failedAfter: failed } = evidence;
      const fresh = evidence.reportFresh;
      // Fewer passing tests than before, failing tests in this session's report, or tests skipped or weakened on
      // the way, contradict "tests pass".
      const worse = before !== null && after !== null && after < before;
      const failing = fresh && failed !== null && failed > 0;
      // Confirmed only by a report written in this session with tests passing and none failing; an old report, or
      // none, shows nothing either way.
      const proven = fresh && failed === 0 && after !== null && after > 0;
      out.push({
        kind: c.kind,
        verdict:
          worse || failing || evidence.weakenedTests > 0
            ? "contradicted"
            : proven
              ? "confirmed"
              : "cannot_check",
      });
      continue;
    }
    const path = c.path ? resolve(normal(c.path), known, list) : null;
    if (!path) continue;
    if (changed === null) {
      out.push({ kind: c.kind, path, verdict: "cannot_check" });
      continue;
    }
    const hit = changed.some((f) => f === path || f.startsWith(`${path}/`));
    out.push({
      kind: c.kind,
      path,
      verdict: (c.kind === "changed_file") === hit ? "confirmed" : "contradicted",
    });
  }
  return out;
}

/** One plain sentence for a claim (fixed words; the path is shown as data by the caller). */
export const CLAIM_LABELS: Record<ClaimKind, string> = {
  tests_added: "Said it added tests",
  tests_pass: "Said the tests pass",
  changed_file: "Said it changed",
  left_untouched: "Said it left untouched",
};
export const VERDICT_LABELS: Record<ClaimVerdict, string> = {
  confirmed: "Confirmed",
  contradicted: "Contradicted",
  cannot_check: "Cannot check",
};
