// Phase 3a: EARS acceptance criteria (Easy Approach to Requirements Syntax). Pure: parse, format and say in plain
// English. Five forms: WHEN (event), IF/THEN (unwanted), WHILE (state), SHALL NOT (never) and plain SHALL (ubiquitous).
import { plainText } from "../text";

export type EarsForm = "event" | "unwanted" | "never" | "state" | "ubiquitous";

export type Ears = {
  form: EarsForm;
  trigger?: string;
  condition?: string;
  state?: string;
  response: string;
  negated: boolean;
};

export const MAX_CRITERION_CHARS = 300;

const SHALL = String.raw`the\s+system\s+shall\b(?:\s+(not)\b)?\s*(.*)$`;
const LEADS: { form: "event" | "unwanted" | "state"; rx: RegExp }[] = [
  { form: "event", rx: new RegExp(String.raw`^when\b\s*(.*?)\s*,?\s*${SHALL}`, "i") },
  {
    form: "unwanted",
    rx: new RegExp(String.raw`^if\b\s*(.*?)\s*,?\s*(?:then\s+)?${SHALL}`, "i"),
  },
  { form: "state", rx: new RegExp(String.raw`^while\b\s*(.*?)\s*,?\s*${SHALL}`, "i") },
];
const PLAIN = new RegExp(`^${SHALL}`, "i");

const tidy = (part: string | undefined) => (part ?? "").replace(/[\s,]+$/, "").trim();

/** One EARS sentence -> its parts; null when it is too long, has no SHALL, or fits none of the five forms. */
export function parseEars(text: string): Ears | null {
  const clean = plainText(text);
  if (clean.length === 0 || clean.length > MAX_CRITERION_CHARS) return null;
  const body = clean.replace(/[\s.]+$/, "");
  if (!/\bshall\b/i.test(body)) return null;
  for (const { form, rx } of LEADS) {
    const m = rx.exec(body);
    if (!m) continue;
    const response = tidy(m[3]);
    if (!response) return null;
    const lead = tidy(m[1]);
    const negated = Boolean(m[2]);
    if (form === "event") return { form, trigger: lead, response, negated };
    if (form === "unwanted") return { form, condition: lead, response, negated };
    return { form, state: lead, response, negated };
  }
  const m = PLAIN.exec(body);
  if (!m) return null;
  const response = tidy(m[2]);
  if (!response) return null;
  return m[1]
    ? { form: "never", response, negated: true }
    : { form: "ubiquitous", response, negated: false };
}

const lead = (keyword: string, part: string | undefined) =>
  part ? `${keyword} ${part}, ` : `${keyword}, `;

/** Canonical text with uppercase keywords; parseEars(formatEars(e)) gives e back. */
export function formatEars(e: Ears): string {
  const shall = `THE SYSTEM SHALL${e.negated || e.form === "never" ? " NOT" : ""} ${e.response}.`;
  switch (e.form) {
    case "event":
      return `${lead("WHEN", e.trigger)}${shall}`;
    case "unwanted":
      return `${lead("IF", e.condition)}THEN ${shall}`;
    case "state":
      return `${lead("WHILE", e.state)}${shall}`;
    default:
      return shall;
  }
}

const IRREGULAR: Record<string, string> = { be: "is", have: "has", do: "does", go: "goes" };

// "send a receipt" -> "sends a receipt". A verb that already ends in a single s ("sends") is left alone.
function thirdPerson(response: string): string {
  const [verb = "", ...rest] = response.split(" ");
  const lower = verb.toLowerCase();
  let out = verb;
  if (IRREGULAR[lower]) out = IRREGULAR[lower];
  else if (/[^aeiou]y$/i.test(verb)) out = `${verb.slice(0, -1)}ies`;
  else if (/(ss|sh|ch|x|z|o)$/i.test(verb)) out = `${verb}es`;
  else if (/[^s]s$/i.test(verb) || !/^[a-z]+$/i.test(verb)) out = verb;
  else out = `${verb}s`;
  return [out, ...rest].join(" ");
}

/** Plain English for the Simple view: "When a user pays, the app sends a receipt." */
export function plainSentence(e: Ears): string {
  const verb = thirdPerson(e.response);
  const main = `the app ${e.negated || e.form === "never" ? "never " : ""}${verb}.`;
  const opener =
    e.form === "event"
      ? ["When", e.trigger]
      : e.form === "unwanted"
        ? ["If", e.condition]
        : e.form === "state"
          ? ["While", e.state]
          : null;
  if (opener?.[1]) return `${opener[0]} ${opener[1]}, ${main}`;
  return `${main.charAt(0).toUpperCase()}${main.slice(1)}`;
}
