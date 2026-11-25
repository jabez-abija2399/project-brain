// FEAT-028: dates people read. "just now", "5 minutes ago", "Today 14:19", "Yesterday 09:02", "3 days ago",
// "12 Nov 2026". Without a time zone (server rendering) it never shows a clock time, so the page never says "UTC";
// the browser then fills in its own time zone (components/ui/when.tsx).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const two = (n: number) => String(n).padStart(2, "0");

type Parts = { y: number; m: number; d: number; hh: number; mm: number };
const partsOf = (date: Date, local: boolean): Parts =>
  local
    ? {
        y: date.getFullYear(),
        m: date.getMonth(),
        d: date.getDate(),
        hh: date.getHours(),
        mm: date.getMinutes(),
      }
    : {
        y: date.getUTCFullYear(),
        m: date.getUTCMonth(),
        d: date.getUTCDate(),
        hh: date.getUTCHours(),
        mm: date.getUTCMinutes(),
      };

const sameDay = (a: Parts, b: Parts) => a.y === b.y && a.m === b.m && a.d === b.d;

/** "12 Nov 2026" (the viewer's calendar when local, else the UTC calendar day). */
export function formatDay(iso: string | Date, local = false): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  const p = partsOf(date, local);
  return `${p.d} ${MONTHS[p.m]} ${p.y}`;
}

/** The full date and time for a tooltip: "12 Nov 2026, 14:19" (local) or "12 Nov 2026" (server). */
export function formatFull(iso: string | Date, local = false): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  if (!local) return formatDay(date);
  const p = partsOf(date, true);
  return `${formatDay(date, true)}, ${two(p.hh)}:${two(p.mm)}`;
}

/**
 * A relative time. With local=true (in the browser) recent days carry the clock time: "Today 14:19". Future times
 * read "in 5 hours" (expiry dates).
 */
export function formatRelative(iso: string | Date, now = new Date(), local = false): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  const diff = now.getTime() - date.getTime();
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < MINUTE) return "in under a minute";
    if (ahead < HOUR) return `in ${plural(Math.round(ahead / MINUTE), "minute")}`;
    if (ahead < DAY) return `in ${plural(Math.round(ahead / HOUR), "hour")}`;
    if (ahead < 14 * DAY) return `in ${plural(Math.round(ahead / DAY), "day")}`;
    return `on ${formatDay(date, local)}`;
  }
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${plural(Math.floor(diff / MINUTE), "minute")} ago`;
  const p = partsOf(date, local);
  const today = partsOf(now, local);
  const yesterday = partsOf(new Date(now.getTime() - DAY), local);
  const clock = `${two(p.hh)}:${two(p.mm)}`;
  if (local && sameDay(p, today)) return `Today ${clock}`;
  if (local && sameDay(p, yesterday)) return `Yesterday ${clock}`;
  if (diff < DAY) return `${plural(Math.floor(diff / HOUR), "hour")} ago`;
  if (!local && sameDay(p, yesterday)) return "yesterday";
  if (diff < 7 * DAY) return `${plural(Math.max(1, Math.round(diff / DAY)), "day")} ago`;
  return formatDay(date, local);
}
