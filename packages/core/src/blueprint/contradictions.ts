// Phase 3a: two criteria that say SHALL and SHALL NOT about the same thing in the same situation contradict each
// other. Deterministic: the subject is the response with filler words and punctuation removed.
import { type Ears, formatEars } from "./ears";

export type Contradiction = {
  a: string;
  b: string;
  code: "shall_vs_shall_not";
  message: string;
  rewrite: string;
};

const FILLER = new Set([
  "a",
  "an",
  "the",
  "any",
  "all",
  "every",
  "ever",
  "not",
  "never",
  "to",
  "of",
  "its",
  "their",
  "our",
  "your",
  "my",
  "this",
  "that",
  "these",
  "those",
]);

function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))
    .join(" ");
}

/** What a criterion is about: its response in lowercase, without filler words, punctuation or "not". */
export function subjectKey(e: Ears): string {
  return words(e.response);
}

function contextKey(e: Ears): string {
  if (e.form === "event") return `when:${words(e.trigger ?? "")}`;
  if (e.form === "unwanted") return `if:${words(e.condition ?? "")}`;
  if (e.form === "state") return `while:${words(e.state ?? "")}`;
  return "always";
}

/** Pairs that say SHALL and SHALL NOT about the same subject in the same situation (a = the earlier one). */
export function contradictions(items: { id: string; ears: Ears }[]): Contradiction[] {
  const groups = new Map<string, { id: string; ears: Ears; negated: boolean }[]>();
  for (const item of items) {
    const subject = subjectKey(item.ears);
    if (!subject) continue;
    const key = `${contextKey(item.ears)}|${subject}`;
    const negated = item.ears.negated || item.ears.form === "never";
    const group = groups.get(key) ?? [];
    group.push({ ...item, negated });
    groups.set(key, group);
  }
  const out: Contradiction[] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (!a || !b || a.negated === b.negated) continue;
        const never = a.negated ? a : b;
        out.push({
          a: a.id,
          b: b.id,
          code: "shall_vs_shall_not",
          message:
            "These two criteria say the app must and must never do the same thing, so keep one or add a condition that tells them apart.",
          rewrite: formatEars(never.ears),
        });
      }
    }
  }
  return out;
}
