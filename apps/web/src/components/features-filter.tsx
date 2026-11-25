"use client";

import { matchesFeature } from "@/lib/ui-helpers";
import { type ReactNode, useEffect, useRef, useState } from "react";

type Filter = "all" | "open" | "todo" | "in_progress" | "done";

// Search and chips for the feature board. Each row carries a marker (data-feature, data-status, data-open) in its
// first cell; rows that do not match get the hidden attribute, so typing re-renders nothing but this bar (INP).
export function FeaturesFilter({
  counts,
  children,
}: {
  /** FEAT-034: the project's counts shown on the chips (the chips are the summary). */
  counts?: { total: number; todo: number; inProgress: number; done: number; withOpenItems: number };
  children?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const chips: [Filter, string, number | undefined][] = [
    ["all", "All", counts?.total],
    ["open", "With open items", counts?.withOpenItems],
    ["todo", "To do", counts?.todo],
    ["in_progress", "In progress", counts?.inProgress],
    ["done", "Done", counts?.done],
  ];

  useEffect(() => {
    const rows = root.current?.querySelectorAll<HTMLTableRowElement>("tbody tr") ?? [];
    let n = 0;
    for (const row of rows) {
      const m = row.querySelector<HTMLElement>("[data-feature]");
      const ok =
        !!m &&
        matchesFeature(m.dataset.feature ?? "", query) &&
        (filter === "all" ||
          (filter === "open" ? Number(m.dataset.open) > 0 : m.dataset.status === filter));
      row.hidden = !ok;
      if (ok) n++;
    }
    setShown(filter === "all" && query.trim() === "" ? null : n);
  }, [filter, query]);

  return (
    <div className="stack">
      <div className="feed-toolbar">
        <fieldset aria-label="Filter features" className="chips">
          {chips.map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              className="chip"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
              {n === undefined ? null : <span className="chip-count">{n}</span>}
            </button>
          ))}
        </fieldset>
        <input
          type="search"
          className="search"
          placeholder="Search features…"
          aria-label="Search features"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <output className="muted" aria-live="polite">
        {shown === null ? "" : `${shown} shown on this page`}
      </output>
      <div ref={root}>{children}</div>
    </div>
  );
}
