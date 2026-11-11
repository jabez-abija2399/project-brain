// Roadmap Phase 11: what the extension shows, built from the CLI's JSON. Everything read is checked and capped here
// (the CLI is trusted, but its answer still passes through this one narrow reader): plain one-line text, numbers as
// numbers, and links only to https pages (http only for localhost).

export type NextStep = { text: string; url: string | null; command: string | null };
export type LastReceipt = {
  id: string | null;
  createdAt: string | null;
  counts: {
    done: number;
    partlyDone: number;
    missed: number;
    notVerified: number;
    securityFindings: number;
    testChecks: number;
    claimsContradicted: number;
  };
  missed: string[];
};
export type TreeRow = { label: string; detail?: string; children?: TreeRow[] };

const MAX_TEXT = 300;
const MAX_MISSED = 20;

// One plain line: control characters and the Unicode direction, zero-width and line-separator marks become spaces.
const hidden = (c: number): boolean =>
  c <= 0x1f ||
  (c >= 0x7f && c <= 0x9f) ||
  (c >= 0x200b && c <= 0x200f) ||
  (c >= 0x2028 && c <= 0x202e) ||
  (c >= 0x2066 && c <= 0x2069) ||
  c === 0xfeff;
export const line = (value: unknown, max = MAX_TEXT): string => {
  if (typeof value !== "string") return "";
  let out = "";
  // Only the first part of a very long value is looked at.
  for (const ch of value.slice(0, max * 4)) out += hidden(ch.codePointAt(0) ?? 0) ? " " : ch;
  return out.replace(/\s+/g, " ").trim().slice(0, max);
};

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.trunc(value), 1_000_000)
    : 0;

const obj = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** A link the editor may open: https, or http on this computer only. Anything else is no link. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const u = new URL(value);
    const local =
      u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.username || u.password) return null;
    return u.protocol === "https:" || (u.protocol === "http:" && local) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** `codeceipt status --json`: the next step, or null when the answer is not one. */
export function parseStatus(json: unknown): NextStep | null {
  const next = obj(obj(json).next);
  const text = line(next.text);
  if (!text) return null;
  const command = line(next.command, 100);
  return {
    text,
    url: safeUrl(next.url),
    // Shown as text only (never run): a codeceipt command, in plain characters.
    command: /^(npx )?codeceipt[\w .@:/=-]*$/.test(command) ? command : null,
  };
}

/** `codeceipt last --json`: the receipt and the receipts page; `receipt` is null when there is none yet. */
export function parseLast(json: unknown): { receipt: LastReceipt | null; url: string | null } {
  const root = obj(json);
  const url = safeUrl(root.url);
  if (typeof root.receipt !== "object" || root.receipt === null) return { receipt: null, url };
  const r = obj(root.receipt);
  const c = obj(r.counts);
  const id = line(r.id, 64);
  const created = line(r.created_at, 30);
  return {
    url,
    receipt: {
      id: /^[\w-]{1,64}$/.test(id) ? id : null,
      createdAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(created) ? created : null,
      counts: {
        done: count(c.done),
        partlyDone: count(c.partly_done),
        missed: count(c.missed),
        notVerified: count(c.not_verified),
        securityFindings: count(c.security_findings),
        testChecks: count(c.test_checks),
        claimsContradicted: count(c.claims_contradicted),
      },
      missed: (Array.isArray(r.missed) ? r.missed : [])
        .slice(0, MAX_MISSED)
        .map((m) => line(m, 200))
        .filter((m) => m.length > 0),
    },
  };
}

/** True when the receipt has something that needs a second look. */
export const needsAttention = (r: LastReceipt): boolean =>
  r.counts.missed +
    r.counts.partlyDone +
    r.counts.securityFindings +
    r.counts.testChecks +
    r.counts.claimsContradicted >
  0;

/** The status bar's short text and its tooltip. */
export function statusBar(
  next: NextStep | null,
  last: LastReceipt | null,
): { text: string; tooltip: string } {
  if (!next && !last)
    return { text: "Codeceipt", tooltip: "Codeceipt: no receipt yet in this folder." };
  const mark = last ? (needsAttention(last) ? "$(warning)" : "$(check)") : "$(info)";
  const short = last
    ? needsAttention(last)
      ? last.counts.missed > 0
        ? `${last.counts.missed} missed`
        : "check the receipt"
      : "all done"
    : "next step";
  return {
    text: `${mark} Codeceipt: ${short}`,
    tooltip: next ? `Next step: ${next.text}` : "Codeceipt",
  };
}

/** The sidebar tree: the next step, then the last receipt's counts and missed items. */
export function tree(next: NextStep | null, last: LastReceipt | null): TreeRow[] {
  const rows: TreeRow[] = [];
  if (next) {
    rows.push({
      label: "Next step",
      detail: next.text,
      children: next.command ? [{ label: "In the terminal", detail: next.command }] : [],
    });
  }
  if (last) {
    const c = last.counts;
    const when = last.createdAt ? `${last.createdAt.slice(0, 16).replace("T", " ")} UTC` : "";
    rows.push({
      label: "Last receipt",
      detail: when,
      children: [
        { label: "Done", detail: String(c.done) },
        { label: "Partly done", detail: String(c.partlyDone) },
        {
          label: "Missed",
          detail: String(c.missed),
          children: last.missed.map((m) => ({ label: m })),
        },
        { label: "Not verified", detail: String(c.notVerified) },
        { label: "Security findings", detail: String(c.securityFindings) },
        { label: "Test checks", detail: String(c.testChecks) },
        { label: "Claims contradicted", detail: String(c.claimsContradicted) },
      ],
    });
  }
  return rows;
}
