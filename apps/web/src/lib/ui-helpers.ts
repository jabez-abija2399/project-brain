// Plain helper functions and constants used by server and client code alike. This file has NO "use client" directive:
// a server component that calls a function exported from a "use client" module gets a client reference instead, and
// the call throws ("Attempted to call dayLabel() from the server but dayLabel is on the client"). Keep helpers here,
// and keep "use client" files to components. server-imports.test.ts enforces this.
import { STATE_LINES, type StateKey, type TermLine } from "@/components/landing/content";
import { normalizeWaitlistEmail } from "@/components/landing/waitlist-email";

// ---- Receipts feed (components/receipts-filter.tsx, the receipts page) ----

const DAY_MS = 86_400_000;

/** "Today", "Yesterday" or the UTC date of a receipt (the feed's day headings). */
export function dayLabel(createdAt: string, now: Date): string {
  const day = createdAt.slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  if (day === today) return "Today";
  if (day === new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10)) return "Yesterday";
  return day;
}

/** Every word of the query appears in the text, in any order, ignoring case. An empty query matches everything. */
export function matchesSearch(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = text.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The card j (dir 1) or k (dir -1) moves to, staying within the visible cards. */
export function nextIndex(current: number, dir: 1 | -1, count: number): number {
  if (count === 0) return -1;
  if (current < 0) return 0;
  return Math.min(count - 1, Math.max(0, current + dir));
}

// ---- Feature board (components/features-filter.tsx) ----

/** Every word of the query appears in the feature's name, in any order, ignoring case. */
export function matchesFeature(name: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = name.toLowerCase();
  return words.every((w) => hay.includes(w));
}

// ---- Clipboard (components/ui/copy-button.tsx, components/landing/command-box.tsx) ----

type Clipboard = { writeText(text: string): Promise<void> };

export type CopyState = "idle" | "copied" | "failed";

/** Copies text; "failed" when the browser has no clipboard or refuses (the button then says what to do instead). */
export async function copyText(
  text: string,
  clipboard: Clipboard | undefined = globalThis.navigator?.clipboard,
): Promise<"copied" | "failed"> {
  try {
    if (!clipboard) return "failed";
    await clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

/** The copy button's word for each state. */
export function copyLabel(state: CopyState): string {
  return state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy";
}

// ---- Waitlist (components/landing/waitlist-form.tsx) ----

export const WAITLIST_THANKS = "You're on the list. We'll email you when your invite is ready.";
const INVALID = "Enter an email address, for example you@example.com.";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Sends the email to the beta waitlist (launch part 5) and returns what to show under the form. */
export async function joinWaitlist(
  email: string,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<{ ok: boolean; message: string }> {
  const value = normalizeWaitlistEmail(email);
  if (!value) return { ok: false, message: INVALID };
  let res: Response;
  try {
    res = await fetchImpl("/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: value }),
    });
  } catch {
    return { ok: false, message: "Could not reach the server. Try again." };
  }
  if (res.ok) return { ok: true, message: WAITLIST_THANKS };
  if (res.status === 429)
    return { ok: false, message: "Too many tries: wait a minute and try again." };
  if (res.status === 400) return { ok: false, message: INVALID };
  return { ok: false, message: "Something went wrong on our side. Try again later." };
}

// ---- Landing page (components/landing/*) ----

/** The tab a key moves to (WAI-ARIA tabs: arrows wrap, Home and End jump), or null for other keys. */
export function tabAfterKey(key: string, current: number, count: number): number | null {
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

// Typing speed: what you type appears a character per tick; output lines appear whole, a few ticks apart.
export const TICK_MS = 18;
const OUTPUT_TICKS = 6;
const typed = (l: TermLine) => l.kind === "cmd" || l.kind === "you";
const cost = (l: TermLine) => (typed(l) ? l.text.length + OUTPUT_TICKS : OUTPUT_TICKS);

/** Ticks until a step's sequence has fully played. */
export function totalTicks(lines: TermLine[]): number {
  return lines.reduce((n, l) => n + cost(l), 0);
}

/** The lines visible after `tick` ticks; a line being typed is cut at the characters typed so far. */
export function visibleLines(lines: TermLine[], tick: number): TermLine[] {
  const out: TermLine[] = [];
  let left = tick;
  for (const l of lines) {
    if (left <= 0) break;
    if (typed(l) && left < l.text.length) {
      out.push({ ...l, text: l.text.slice(0, left) });
      break;
    }
    out.push(l);
    left -= cost(l);
  }
  return out;
}

// The one example behind "What leaves your machine": a code change and the exact evidence line made from it.
export const EXAMPLE_CODE = [
  "// Payments are only called from checkout.",
  "// Prices come from the server, never the browser.",
  "// Refunds go through the dashboard for now.",
  "// Keep UI code out of this file.",
  "// Owner: billing.",
];
export const EXAMPLE_EVIDENCE =
  "src/lib/payments.ts: +5 -0, comment only, top of file (outside the request's feature)";

/** The receipt lines a state highlights. */
export function linesFor(state: StateKey) {
  return STATE_LINES.filter((l) => l.state === state);
}

// ---- Project switcher (components/shell/project-switcher.tsx) ----

/** The project the address points at (/projects/<id>/...), or null. */
export function currentProjectId(pathname: string | null): string | null {
  const m = /^\/projects\/([\w-]{1,64})(?:\/|$)/.exec(pathname ?? "");
  return m?.[1] ?? null;
}
