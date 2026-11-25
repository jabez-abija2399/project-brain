"use client";

import type { Filter } from "@/lib/receipt-filters";

import { matchesSearch, nextIndex } from "@/lib/ui-helpers";
import { type ReactNode, useEffect, useRef, useState } from "react";

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

// Filter chips (All, Needs attention, All good), search by what was asked, and keyboard shortcuts: "/" search, j/k
// next and previous receipt, o open or close. Filtering is a data attribute plus the hidden attribute on cards that
// do not match, so a key press re-renders nothing but this bar (INP).
export function ReceiptsFilter({
  total,
  attention,
  missed = 0,
  findings = 0,
  initial = "all",
  children,
}: {
  total: number;
  attention: number;
  /** FEAT-032: receipts with a missed item, and with a security problem (their chips show when any exist). */
  missed?: number;
  findings?: number;
  /** FEAT-032: the filter the page opens with (?filter= from the overview's cards). */
  initial?: Filter;
  children?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>(initial);
  const [query, setQuery] = useState("");
  // FEAT-033: how many cards the search and chip leave on screen, and the "?" shortcut sheet.
  const [visible, setVisible] = useState(total);
  const [help, setHelp] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const chips: [Filter, string, number][] = [
    ["all", "All", total],
    ["attention", "Needs attention", attention],
    ["good", "All good", total - attention],
    ...(missed > 0 || initial === "missed"
      ? [["missed", "Something missed", missed] as [Filter, string, number]]
      : []),
    ...(findings > 0 || initial === "findings"
      ? [["findings", "Security problems", findings] as [Filter, string, number]]
      : []),
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
    const inView = (li: HTMLElement) =>
      filter === "all" ||
      (filter === "attention" && li.dataset.attention === "true") ||
      (filter === "good" && li.dataset.attention === "false") ||
      (filter === "missed" && li.dataset.missed === "true") ||
      (filter === "findings" && li.dataset.findings === "true");
    setVisible(
      [...root.querySelectorAll<HTMLElement>("li[data-search]")].filter(
        (li) => !li.hidden && inView(li),
      ).length,
    );
  }, [query, filter]);

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
      if (e.key === "?") {
        e.preventDefault();
        setHelp((h) => !h);
        return;
      }
      if (e.key === "Escape") {
        setHelp(false);
        return;
      }
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
        <kbd>/</kbd> search · <kbd>j</kbd> <kbd>k</kbd> next and previous · <kbd>o</kbd> open ·{" "}
        <button type="button" className="link-button" onClick={() => setHelp((h) => !h)}>
          <kbd>?</kbd> all shortcuts
        </button>
      </p>
      <section
        id="shortcut-help"
        className="card stack shortcut-help"
        aria-label="Keyboard shortcuts"
        hidden={!help}
      >
        <h2 className="subhead m0">Keyboard shortcuts</h2>
        <dl className="facts m0">
          <div>
            <dt>
              <kbd>/</kbd>
            </dt>
            <dd>Search what was asked</dd>
          </div>
          <div>
            <dt>
              <kbd>j</kbd> <kbd>k</kbd>
            </dt>
            <dd>Next and previous receipt</dd>
          </div>
          <div>
            <dt>
              <kbd>o</kbd>
            </dt>
            <dd>Open or close the receipt</dd>
          </div>
          <div>
            <dt>
              <kbd>?</kbd>
            </dt>
            <dd>Show or hide this list (Escape closes it)</dd>
          </div>
        </dl>
      </section>
      {visible === 0 ? (
        <p className="empty-match m0" data-testid="no-match">
          {query ? <>No receipts match &ldquo;{query}&rdquo;. </> : <>No receipts in this view. </>}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            {query ? "Clear search" : "Show all"}
          </button>
        </p>
      ) : null}
      <div ref={list} className="receipts-filtered" data-filter={filter}>
        {children}
      </div>
    </div>
  );
}
