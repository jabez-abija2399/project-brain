"use client";

import { type ReactNode, useState } from "react";

type Filter = "all" | "attention" | "good";

// Filter chips for the receipts feed: All, Needs attention, All good. Filtering is a data attribute on the list (CSS
// hides the others), so a click re-renders nothing but the chips (INP).
export function ReceiptsFilter({
  total,
  attention,
  children,
}: {
  total: number;
  attention: number;
  children?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const chips: [Filter, string, number][] = [
    ["all", "All", total],
    ["attention", "Needs attention", attention],
    ["good", "All good", total - attention],
  ];
  return (
    <div className="stack">
      <fieldset aria-label="Filter receipts" className="chips">
        {chips.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className="chip-count">{count}</span>
          </button>
        ))}
      </fieldset>
      <div className="receipts-filtered" data-filter={filter}>
        {children}
      </div>
    </div>
  );
}
