import { TEST_FILE } from "./receipt";

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
  /** Repo-relative paths the session changed. */
  changedFiles: string[];
  /** Passing tests before and after, when a test report was found (else null). */
  passingBefore: number | null;
  passingAfter: number | null;
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
const UNTOUCHED =
  /\b(did(?: not|n't)|have(?: not|n't)|has(?: not|n't)|without|no changes? to|left|untouched|unchanged)\b/i;
const UNTOUCHED_VERB =
  /\b(touch(?:ed|ing)?|chang(?:e|ed|ing)|modif(?:y|ied|ying)|edit(?:ed|ing)?|untouched|unchanged|alone|as (?:it|they) (?:is|are|was|were))\b/i;
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
    const untouched = UNTOUCHED.test(s) && UNTOUCHED_VERB.test(s);
    if (!untouched && TESTS_PASS.test(s) && !NEGATED.test(s)) add({ kind: "tests_pass" });
    if (!untouched && TESTS_ADDED.test(s) && !NEGATED.test(s)) add({ kind: "tests_added" });
    for (const m of s.matchAll(PATH)) {
      const path = normal(m[1] ?? "");
      // Only paths inside the repo: no "." or ".." parts (a claim never names a file outside it).
      if (path.split("/").some((part) => part === "" || part === "." || part === "..")) continue;
      // Version numbers, sentences ending in a word and URLs are not paths.
      if (path.length > MAX_PATH || /^\d+(\.\d+)*$/.test(path) || /^(https?|www)\b/i.test(path))
        continue;
      if (
        !path.includes("/") &&
        !/\.(ts|tsx|js|jsx|mjs|cjs|json|sql|md|css|html|py|go|rs|yml|yaml|toml|sh)$/i.test(path)
      )
        continue;
      if (untouched) add({ kind: "left_untouched", path });
      else if (CHANGED.test(s)) add({ kind: "changed_file", path });
    }
  }
  return out;
}

/** True when `claimed` names `changed`: the same path, or its ending at a folder boundary (agents shorten paths). */
const names = (claimed: string, changed: string) =>
  changed === claimed || changed.endsWith(`/${claimed}`) || changed.startsWith(`${claimed}/`);

/** Each claim against the evidence. Fail closed: without evidence the verdict is "cannot check", never "confirmed". */
export function checkClaims(claims: Claim[], evidence: ClaimEvidence): CheckedClaim[] {
  const changed = evidence.changedFiles.map(normal);
  return claims.slice(0, MAX_CLAIMS).map((c): CheckedClaim => {
    if (c.kind === "tests_added") {
      return {
        ...c,
        verdict: changed.some((f) => TEST_FILE.test(f)) ? "confirmed" : "contradicted",
      };
    }
    if (c.kind === "tests_pass") {
      const { passingBefore: before, passingAfter: after } = evidence;
      // Fewer passing tests than before, or tests skipped or weakened on the way, contradicts "tests pass".
      if (before !== null && after !== null && after < before)
        return { ...c, verdict: "contradicted" };
      if (evidence.weakenedTests > 0) return { ...c, verdict: "contradicted" };
      // No test report on this machine: nothing shows it either way.
      return { ...c, verdict: after !== null && after > 0 ? "confirmed" : "cannot_check" };
    }
    const path = c.path ? normal(c.path) : "";
    if (!path) return { ...c, verdict: "cannot_check" };
    const hit = changed.some((f) => names(path, f));
    if (c.kind === "changed_file") return { ...c, verdict: hit ? "confirmed" : "contradicted" };
    return { ...c, verdict: hit ? "contradicted" : "confirmed" };
  });
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
