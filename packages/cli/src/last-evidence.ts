import { type ChangeSummary, describeChange, oneLineText } from "@brain/core";

// `codeceipt last --evidence`: what the receipt's judge was given per changed file (D-025), read from the stored
// receipt. The server's answer is data: only identifier-shaped names, known places, bounded counts and clean paths
// are printed, so nothing it says reaches the terminal raw.
const MAX_FILES = 200;
const NAME = /^[A-Za-z_$][\w$.]{0,99}(\*\*\*)?$/;
const PLACE =
  /^(top of file|end of file|new file|deleted file|binary file|large file|symlink|line \d{1,7}|lines \d{1,7}-\d{1,7}|\d{1,7} more places)$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/;

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const count = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, 1_000_000) : 0;
const names = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .filter((n): n is string => typeof n === "string" && NAME.test(n))
    .slice(0, 20);

function summaryOf(raw: unknown): ChangeSummary | null {
  const s = obj(raw);
  if (!s) return null;
  return {
    path: "",
    added: count(s.added),
    removed: count(s.removed),
    comment_only: s.comment_only === true,
    imports_changed: s.imports_changed === true,
    symbols_added: names(s.symbols_added),
    symbols_removed: names(s.symbols_removed),
    symbols_changed: names(s.symbols_changed),
    where: (Array.isArray(s.where) ? s.where : [])
      .filter((w): w is string => typeof w === "string" && PLACE.test(w))
      .slice(0, 6),
    since_session_start: s.since_session_start === true,
  };
}

export function evidenceLines(receipt: Record<string, unknown>): string[] {
  if (!Array.isArray(receipt.evidence)) {
    return ["No evidence was stored with this receipt (it was made before receipts kept it)."];
  }
  const lines = ["Evidence sent to the judge (no source code):"];
  for (const raw of receipt.evidence.slice(0, MAX_FILES)) {
    const e = obj(raw);
    // Paths are the receipt's own changed files; one with control characters is not ours to print.
    if (!e || typeof e.path !== "string" || CONTROL.test(e.path)) continue;
    const path = oneLineText(e.path).slice(0, 300);
    const s = summaryOf(e.summary);
    if (!s) {
      lines.push(`  ${path}: no change summary (paths only)`);
      continue;
    }
    const scope = [
      e.in_scope === true ? "in the request's feature" : "outside the request's feature",
      ...(e.pre_existing === true
        ? [
            s.since_session_start
              ? "already modified before the session, this session's edits only"
              : "already modified before the session, includes earlier edits",
          ]
        : []),
    ].join("; ");
    lines.push(`  ${path}: ${describeChange(s)} (${scope})`);
  }
  if (receipt.no_change_summaries === true) {
    lines.push(
      "The CLI sent no change summaries for this receipt (an older codeceipt?), so the judge saw paths only.",
    );
  }
  return lines;
}
