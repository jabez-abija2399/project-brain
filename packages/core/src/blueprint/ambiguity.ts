// Phase 3a: deterministic ambiguity checks for one acceptance criterion. Each flag is one plain sentence plus, where
// one exists, a rewrite the user can accept. No LLM: the same text always gives the same flags.
import { plainText } from "../text";
import { type Ears, MAX_CRITERION_CHARS, formatEars } from "./ears";

export type FlagCode =
  | "vague_word"
  | "weak_modal"
  | "missing_trigger"
  | "missing_actor"
  | "unmeasurable_perf"
  | "compound";

export type Flag = { code: FlagCode; message: string; span?: string; rewrite?: string };

// Vague word -> the kind of detail that should replace it.
const VAGUE: [RegExp, string][] = [
  [/\bfast\b/i, "<a time limit, e.g. within 500 ms>"],
  [/\bquick\b/i, "<a time limit, e.g. within 500 ms>"],
  [/\buser-friendly\b/i, "<a step a user can check, e.g. in at most 3 clicks>"],
  [/\beasy\b/i, "<a step a user can check, e.g. in at most 3 clicks>"],
  [/\bintuitive\b/i, "<a step a user can check, e.g. without reading help>"],
  [/\bseamless\b/i, "<what the user sees, e.g. without a page reload>"],
  [/\bsimple\b/i, "<a step a user can check, e.g. one form with 3 fields>"],
  [/\brobust\b/i, "<the failure it survives, e.g. retries 3 times>"],
  [/\bappropriate\b/i, "<the exact rule>"],
  [/\betc\b\.?/i, "<the full list>"],
  [/\band so on\b/i, "<the full list>"],
];

const WEAK = /\b(should|may|might|could|ideally)\b/gi;
const PERF = /\b(fast|faster|quick|quickly|slow|slowly|performance|latency|responsive)\b/i;
const MEASURED =
  /\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|secs?|seconds?|minutes?|%|kb|mb|gb|requests?|rps)(?![a-z])/i;
const SYSTEM_SUBJECT =
  /^(?:the\s+)?(?:app|system|application|site|website|service|platform|server)\s+(?:should|must|will|shall|may|might|could|can|needs?\s+to|has\s+to|is\s+able\s+to)\s+(.+)$/i;

const sentence = (text: string) => plainText(text).replace(/[\s.]+$/, "");

// Best-effort EARS version of a sentence that is not in EARS form.
function earsRewrite(text: string): string {
  const t = sentence(text);
  if (!t) return "THE SYSTEM SHALL <what the app does>.";
  const lead = /^(when|if|while)\s+(.+?),\s*(.+)$/i.exec(t);
  if (lead) {
    const keyword = (lead[1] ?? "").toUpperCase();
    const rest = earsRewrite(lead[3] ?? "").replace(/^THE SYSTEM SHALL /, "");
    return `${keyword} ${lead[2]}, ${keyword === "IF" ? "THEN " : ""}THE SYSTEM SHALL ${rest}`;
  }
  const subject = SYSTEM_SUBJECT.exec(t);
  if (subject) return `THE SYSTEM SHALL ${subject[1]}.`;
  return `THE SYSTEM SHALL ensure that ${t.charAt(0).toLowerCase()}${t.slice(1)}.`;
}

function splitAndOr(text: string): [string, string] {
  return [
    text.replace(/\s+and\/or\s+\S+/i, "").trim(),
    text.replace(/\S+\s+and\/or\s+/i, "").trim(),
  ];
}

function compoundRewrite(text: string, ears: Ears | null): string | null {
  const t = sentence(text);
  if (/\sand\/or\s/i.test(t)) {
    const [a, b] = ears ? splitAndOr(ears.response) : splitAndOr(t);
    const one = ears ? formatEars({ ...ears, response: a }) : `${a}.`;
    const two = ears ? formatEars({ ...ears, response: b }) : `${b}.`;
    return `${one} ${two}`;
  }
  const two =
    /^(.*?\bshall\b.*?)\s*[,;]?\s*(?:\b(?:and|but|also)\b\s*)?(?:\bthe\s+system\s+)?\bshall\b\s*(.+)$/i.exec(
      t,
    );
  if (!two) return null;
  const first = (two[1] ?? "").trim();
  let second = (two[2] ?? "").trim();
  const negated = /^not\b/i.test(second);
  if (negated) second = second.replace(/^not\s*/i, "");
  const firstEars = ears
    ? { ...ears, response: first.replace(/^.*?\bshall\b\s*(?:not\b\s*)?/i, "") }
    : null;
  const one = firstEars ? formatEars(firstEars) : `${first}.`;
  const base: Ears = ears ?? { form: "ubiquitous", response: second, negated };
  const rest = formatEars({
    ...base,
    form: base.form === "never" && !negated ? "ubiquitous" : base.form,
    response: second,
    negated,
  });
  return `${one} ${rest}`;
}

/** Flags for one criterion; `ears` is parseEars(text) (null when the text is not EARS). */
export function ambiguityFlags(text: string, ears: Ears | null): Flag[] {
  const t = plainText(text);
  const flags: Flag[] = [];
  if (t.length > MAX_CRITERION_CHARS) {
    flags.push({
      code: "compound",
      message: `This criterion is longer than ${MAX_CRITERION_CHARS} characters, so split it into shorter ones.`,
    });
    return flags;
  }

  for (const [rx, hint] of VAGUE) {
    const m = rx.exec(t);
    if (!m) continue;
    flags.push({
      code: "vague_word",
      span: m[0],
      message: `"${m[0]}" means different things to different people, so say exactly what you expect.`,
      rewrite: t.replace(rx, hint),
    });
  }

  const seen = new Set<string>();
  for (const m of t.matchAll(WEAK)) {
    const word = m[0];
    if (seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    const rewrite =
      word.toLowerCase() === "ideally"
        ? t.replace(new RegExp(`\\s*\\b${word}\\b,?`, "i"), "").trim()
        : t.replace(new RegExp(`\\b${word}\\b`), "SHALL");
    flags.push({
      code: "weak_modal",
      span: word,
      message: `"${word}" makes this optional, so use SHALL if the app must always do it.`,
      rewrite,
    });
  }

  if (ears) {
    const lead =
      ears.form === "event"
        ? { key: "trigger" as const, word: "event", placeholder: "<what happens first>" }
        : ears.form === "unwanted"
          ? { key: "condition" as const, word: "condition", placeholder: "<the problem case>" }
          : ears.form === "state"
            ? { key: "state" as const, word: "state", placeholder: "<the state the app is in>" }
            : null;
    if (lead && !ears[lead.key]) {
      flags.push({
        code: "missing_trigger",
        message: `This criterion starts with a keyword but never says which ${lead.word} it is about.`,
        rewrite: formatEars({ ...ears, [lead.key]: lead.placeholder }),
      });
    }
  } else {
    flags.push({
      code: "missing_actor",
      message:
        "This is not written as 'THE SYSTEM SHALL …', so it is unclear what the app itself must do.",
      rewrite: earsRewrite(t),
    });
  }

  const perf = PERF.exec(t);
  if (perf && !MEASURED.test(t)) {
    const base = sentence(ears ? formatEars(ears) : t)
      .replace(/\s*,?\s*\b(?:quickly|fast|quick)\b/i, "")
      .trim();
    flags.push({
      code: "unmeasurable_perf",
      span: perf[0],
      message: `"${perf[0]}" cannot be tested without a number, so give a time or size limit.`,
      rewrite: `${base} within <N> ms (p95).`,
    });
  }

  const shalls = t.match(/\bshall\b/gi)?.length ?? 0;
  if (/\sand\/or\s/i.test(t) || shalls >= 2) {
    const rewrite = compoundRewrite(t, ears);
    flags.push({
      code: "compound",
      message: "This criterion asks for more than one thing, so split it into one criterion each.",
      ...(rewrite ? { rewrite } : {}),
    });
  }
  return flags;
}
