// Text that reaches an agent's context or a terminal is one plain line: C0 and C1 control characters (NUL, ESC,
// BEL, NEL U+0085), Unicode line and paragraph separators and bidi embedding/override/isolate characters become
// spaces, so no saved text can start a new line, forge a heading or rewrite what a terminal shows.
// Built from a string of regex escapes so no raw control or separator character sits in the source.
export const UNSAFE_TEXT_CHARS =
  "\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069";
const UNSAFE = new RegExp(`[${UNSAFE_TEXT_CHARS}]`, "g");

export function oneLineText(value: string): string {
  return value.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
}

// Zero-width and direction marks (U+200B-U+200F, U+2060, U+FEFF, U+061C) that oneLineText keeps. Text that is
// matched or compared (feature names, section words) drops them, so a hidden mark cannot split a word or make two
// names that look identical differ.
const INVISIBLE = /[\u200b-\u200f\u2060\ufeff\u061c]/g;

/** oneLineText without invisible marks: what a reader sees is exactly what is stored and compared. */
export function plainText(value: string): string {
  return oneLineText(value.replace(INVISIBLE, ""));
}
