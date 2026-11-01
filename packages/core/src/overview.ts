// The project overview (2026-11-01): what needs attention, why, and how the last two weeks went. Pure arithmetic
// over receipt views (already cleaned and masked by receiptView); the dashboard only renders it.
import type { ReceiptView } from "./fix-prompt";

const DAYS = 14;
const WEEK = 7;
const MAX_ATTENTION = 5;
const DAY_MS = 86_400_000;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const count = (view: ReceiptView, status: string) =>
  view.items.filter((i) => i.status === status).length;

/** Something on the receipt needs the user: missed or partly done items, findings, test checks, edits outside scope. */
export function receiptNeedsAttention(view: ReceiptView): boolean {
  return attentionReasons(view).length > 0;
}

/** Why a receipt needs attention, most serious first ("1 security finding", "2 missed"). Empty when all is good. */
export function attentionReasons(view: ReceiptView): string[] {
  const findings = view.findings.length + view.findingsOmitted;
  const reasons = [
    [findings, plural(findings, "security finding")],
    [view.testChecks.length, plural(view.testChecks.length, "test check")],
    [count(view, "missed"), `${count(view, "missed")} missed`],
    [count(view, "partial"), `${count(view, "partial")} partly done`],
    [
      view.outsideScope.length,
      plural(view.outsideScope.length, "file outside scope", "files outside scope"),
    ],
  ] as const;
  return reasons.filter(([n]) => n > 0).map(([, text]) => text);
}

export type OverviewRow = {
  id: string;
  createdAt: string;
  asked: string | null;
  view: ReceiptView;
};
export type OverviewStats = {
  // Oldest first, one entry per UTC day, ending today.
  days: { date: string; good: number; attention: number }[];
  // The last 7 days. doneRate: done (with or without a test) out of judged items, null when nothing was judged.
  week: { receipts: number; doneRate: number | null; findings: number; attention: number };
  // The newest receipts needing attention, with their reasons.
  attention: { id: string; asked: string | null; createdAt: string; reasons: string[] }[];
};

export function overviewStats(rows: OverviewRow[], now: Date): OverviewStats {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Array.from({ length: DAYS }, (_, i) => ({
    date: new Date(today - (DAYS - 1 - i) * DAY_MS).toISOString().slice(0, 10),
    good: 0,
    attention: 0,
  }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const weekStart = today - (WEEK - 1) * DAY_MS;
  const week = { receipts: 0, done: 0, judged: 0, findings: 0, attention: 0 };
  const attention: OverviewStats["attention"] = [];
  for (const r of rows) {
    const at = Date.parse(r.createdAt);
    if (Number.isNaN(at)) continue;
    const needs = receiptNeedsAttention(r.view);
    const day = byDate.get(new Date(at).toISOString().slice(0, 10));
    if (day) {
      if (needs) day.attention++;
      else day.good++;
    }
    if (at >= weekStart) {
      const done = count(r.view, "done") + count(r.view, "done_untested");
      week.receipts++;
      week.done += done;
      week.judged += done + count(r.view, "missed") + count(r.view, "partial");
      week.findings += r.view.findings.length + r.view.findingsOmitted;
      if (needs) week.attention++;
    }
    if (needs && attention.length < MAX_ATTENTION) {
      attention.push({
        id: r.id,
        asked: r.asked,
        createdAt: r.createdAt,
        reasons: attentionReasons(r.view),
      });
    }
  }
  return {
    days,
    week: {
      receipts: week.receipts,
      doneRate: week.judged > 0 ? Math.round((week.done / week.judged) * 100) : null,
      findings: week.findings,
      attention: week.attention,
    },
    attention,
  };
}
