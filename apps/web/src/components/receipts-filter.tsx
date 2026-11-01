"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type Filter = "all" | "attention" | "good";

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

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

// Filter chips (All, Needs attention, All good), search by what was asked, and keyboard shortcuts: "/" search, j/k
// next and previous receipt, o open or close. Filtering is a data attribute plus the hidden attribute on cards that
// do not match, so a key press re-renders nothing but this bar (INP).
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
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const chips: [Filter, string, number][] = [
    ["all", "All", total],
    ["attention", "Needs attention", attention],
    ["good", "All good", total - attention],
  ];

  // Search: hide cards that do not match, and day headings left with no visible card.
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    let heading: HTMLElement | null = null;
    let shown = 0;
    const closeHeading = () => {
      if (heading) heading.hidden = shown === 0;
    };
    for (const li of root.querySelectorAll<HTMLElement>("li.day-heading, li[data-search]")) {
      if (li.classList.contains("day-heading")) {
        closeHeading();
        heading = li;
        shown = 0;
        continue;
      }
      li.hidden = !matchesSearch(li.dataset.search ?? "", query);
      if (!li.hidden) shown++;
    }
    closeHeading();
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typing(e.target)) {
        if (e.key === "Escape" && e.target === search.current) {
          setQuery("");
          search.current?.blur();
        }
        return;
      }
      const root = list.current;
      if (!root) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
        return;
      }
      // Only cards on screen (not hidden by the search or the chips) take part.
      const cards = [...root.querySelectorAll<HTMLElement>("li[data-search] summary")].filter(
        (s) => s.offsetParent !== null,
      );
      const at = cards.indexOf(document.activeElement as HTMLElement);
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const card = cards[nextIndex(at, e.key === "j" ? 1 : -1, cards.length)];
        card?.focus();
        card?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "o" && at >= 0) {
        e.preventDefault();
        cards[at]?.click();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="stack">
      <div className="feed-toolbar">
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
        <input
          ref={search}
          type="search"
          className="search"
          placeholder="Search what was asked…"
          aria-label="Search receipts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <p className="shortcuts muted">
        <kbd>/</kbd> search · <kbd>j</kbd> <kbd>k</kbd> next and previous · <kbd>o</kbd> open
      </p>
      <div ref={list} className="receipts-filtered" data-filter={filter}>
        {children}
      </div>
    </div>
  );
}
