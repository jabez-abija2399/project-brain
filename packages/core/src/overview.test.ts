import { describe, expect, it } from "vitest";
import { receiptView } from "./fix-prompt";
import { attentionReasons, overviewStats, receiptNeedsAttention } from "./overview";

// The project overview (2026-11-01): lead with what needs attention, summarize, then drill down. Pure arithmetic over
// stored receipts; the page only renders it.
const NOW = new Date("2026-11-01T12:00:00.000Z");
const at = (daysAgo: number, hour = 10) =>
  new Date(Date.UTC(2026, 10, 1 - daysAgo, hour)).toISOString();
const item = (status: string) => ({ id: status, text: `Item ${status}`, status, evidence: [] });
const row = (id: string, daysAgo: number, summary: Record<string, unknown>) => ({
  id,
  createdAt: at(daysAgo),
  asked: `Request ${id}`,
  view: receiptView(summary),
});

describe("receipt attention", () => {
  it("says why a receipt needs attention, most serious first, and nothing for an all-good one", () => {
    const view = receiptView({
      items: [item("missed"), item("missed"), item("partial"), item("done")],
      findings: [{ type: "stripe_secret_key", file: "a.ts", line: 1, hint: "x" }],
      outside_scope: ["src/billing/Invoice.tsx"],
      test_integrity: {
        flags: [{ kind: "deleted_tests", file: "a.test.ts", names: [], count: 1 }],
      },
    });
    expect(receiptNeedsAttention(view)).toBe(true);
    expect(attentionReasons(view)).toEqual([
      "1 security finding",
      "1 test check",
      "2 missed",
      "1 partly done",
      "1 file outside scope",
    ]);
    const good = receiptView({ items: [item("done"), item("done_untested"), item("question")] });
    expect(receiptNeedsAttention(good)).toBe(false);
    expect(attentionReasons(good)).toEqual([]);
  });
});

describe("overview stats", () => {
  const rows = [
    row("r1", 0, { items: [item("missed")] }),
    row("r2", 0, { items: [item("done"), item("done_untested")] }),
    row("r3", 2, {
      items: [item("done")],
      findings: [{ type: "rls_disabled", file: "", hint: "x" }],
    }),
    row("r4", 9, { items: [item("missed"), item("partial")] }),
    row("r5", 20, { items: [item("missed")] }),
  ];

  it("buckets the last 14 days, oldest first, split into all good and needs attention", () => {
    const s = overviewStats(rows, NOW);
    expect(s.days).toHaveLength(14);
    expect(s.days.at(-1)).toEqual({ date: "2026-11-01", good: 1, attention: 1 });
    expect(s.days.at(-3)).toEqual({ date: "2026-10-30", good: 0, attention: 1 });
    expect(s.days[0]?.date).toBe("2026-10-19");
    // r5 is older than 14 days: not in the chart.
    expect(s.days.reduce((n, d) => n + d.good + d.attention, 0)).toBe(4);
  });

  it("counts the last 7 days: done rate over judged items, findings, and receipts needing attention", () => {
    const s = overviewStats(rows, NOW);
    // Last 7 days: r1 (missed), r2 (done, done_untested), r3 (done) -> 3 done of 4 judged.
    expect(s.week).toEqual({ receipts: 3, doneRate: 75, findings: 1, attention: 2 });
  });

  it("lists the newest receipts needing attention with their reasons, at most 5", () => {
    const many = Array.from({ length: 8 }, (_, i) => row(`m${i}`, i, { items: [item("missed")] }));
    const s = overviewStats(many, NOW);
    expect(s.attention).toHaveLength(5);
    expect(s.attention[0]).toEqual({
      id: "m0",
      asked: "Request m0",
      createdAt: at(0),
      reasons: ["1 missed"],
    });
  });

  it("no receipts: an empty chart and no done rate (never a made-up 0 % or 100 %)", () => {
    const s = overviewStats([], NOW);
    expect(s.days.every((d) => d.good === 0 && d.attention === 0)).toBe(true);
    expect(s.week).toEqual({ receipts: 0, doneRate: null, findings: 0, attention: 0 });
    expect(s.attention).toEqual([]);
  });
});
