// Roadmap Phase 5 (Codeceipt Guard): characters a person reading a diff cannot see or tell apart. Bidi controls can
// make code read differently from how it runs ("Trojan Source"), zero-width marks split or join names, tag characters
// carry text only a model reads ("ASCII smuggling"), and a Cyrillic or Greek letter inside a Latin word makes a name
// that looks identical to another. Reported per line with the character's code point only, never the line itself.

export type HiddenKind = "bidi" | "invisible" | "tag" | "lookalike";
export type HiddenChar = { line: number; kind: HiddenKind; code: string };

const MAX_PER_TEXT = 50;
const BIDI = /[\u202a-\u202e\u2066-\u2069]/u;
// Zero-width and direction marks, the soft hyphen, the Mongolian vowel separator, word joiners and invisible operators,
// and the variation selectors supplement (U+E0100-U+E01EF, never needed in code). U+200D (zero-width joiner) is
// allowed between two emoji, where it builds one picture; U+FEFF only as a file's first character (a byte-order mark).
const INVISIBLE = /[\u200b-\u200f\u2060-\u2064\ufeff\u061c\u180e\u00ad]/u;
// Combining marks, so kept in a class of their own.
const SELECTOR_SUPPLEMENT = /\p{Variation_Selector}/u;
const TAG = /[\u{e0000}-\u{e007f}]/u;
const EMOJI = /\p{Extended_Pictographic}/u;
const WORD = /[\p{L}\p{M}\p{N}_$]+/gu;
const LATIN = /\p{Script=Latin}/u;
const LOOKALIKE =
  /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\uff21-\uff3a\uff41-\uff5a]/u;

export const codePoint = (ch: string) =>
  `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;

function kindOf(chars: string[], i: number, atStart: boolean): HiddenKind | null {
  const ch = chars[i] ?? "";
  if (BIDI.test(ch)) return "bidi";
  if (TAG.test(ch)) return "tag";
  if (ch === "\u200d") {
    return EMOJI.test(chars[i - 1] ?? "") && EMOJI.test(chars[i + 1] ?? "") ? null : "invisible";
  }
  if (ch === "\ufeff" && atStart) return null;
  // Variation selectors U+FE00-U+FE0F pick an emoji or text style; the supplement (U+E0100 and up) is never needed.
  if (SELECTOR_SUPPLEMENT.test(ch) && (ch.codePointAt(0) ?? 0) >= 0xe0100) return "invisible";
  return INVISIBLE.test(ch) ? "invisible" : null;
}

/**
 * Hidden or lookalike characters in `text`, one entry per line (the first one found on it), at most 50. `only` limits
 * the check to those line numbers (1-based), e.g. the lines a change added.
 */
export function findHiddenChars(text: string, only?: Set<number>): HiddenChar[] {
  const out: HiddenChar[] = [];
  const lines = text.split("\n");
  for (const [n, line] of lines.entries()) {
    if (out.length >= MAX_PER_TEXT) break;
    if (only && !only.has(n + 1)) continue;
    // Plain ASCII lines (most of any change) cannot hold any of these.
    if (!/[\u0080-\u{10ffff}]/u.test(line)) continue;
    const chars = Array.from(line);
    let found: HiddenChar | null = null;
    for (let i = 0; i < chars.length && !found; i++) {
      const kind = kindOf(chars, i, n === 0 && i === 0);
      if (kind) found = { line: n + 1, kind, code: codePoint(chars[i] ?? "") };
    }
    if (!found) {
      for (const word of line.match(WORD) ?? []) {
        if (!LATIN.test(word)) continue;
        const odd = Array.from(word).find((c) => LOOKALIKE.test(c));
        if (odd) {
          found = { line: n + 1, kind: "lookalike", code: codePoint(odd) };
          break;
        }
      }
    }
    if (found) out.push(found);
  }
  return out;
}
