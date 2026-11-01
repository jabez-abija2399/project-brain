"use client";

import { type KeyboardEvent, useRef, useState } from "react";
import { AGENT_TABS } from "./content";
import { InlineCode } from "./inline-code";

/** The tab a key moves to (WAI-ARIA tabs: arrows wrap, Home and End jump), or null for other keys. */
export function tabAfterKey(key: string, current: number, count: number): number | null {
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

const Feature = ({ on, text }: { on: boolean; text: string }) => (
  <li className="agent-feature" data-on={on}>
    <span className="agent-mark" aria-hidden="true">
      {on ? "✓" : "–"}
    </span>
    <span>
      {text}: <strong>{on ? "automatic" : "not automatic"}</strong>
    </span>
  </li>
);

// Agent tabs: what works automatically with each agent, said honestly.
export function AgentTabs() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = tabAfterKey(e.key, selected, AGENT_TABS.length);
    if (next === null) return;
    e.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  };
  return (
    <div className="agent-tabs">
      <div role="tablist" aria-label="Agents" className="tablist">
        {AGENT_TABS.map((a, i) => (
          <button
            key={a.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${a.id}`}
            aria-selected={i === selected}
            aria-controls={`panel-${a.id}`}
            tabIndex={i === selected ? 0 : -1}
            className="tab"
            onClick={() => setSelected(i)}
            onKeyDown={onKey}
          >
            {a.name}
          </button>
        ))}
      </div>
      {AGENT_TABS.map((a, i) => (
        <div
          key={a.id}
          role="tabpanel"
          id={`panel-${a.id}`}
          aria-labelledby={`tab-${a.id}`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tabs: the panel takes focus after the tab list.
          tabIndex={0}
          hidden={i !== selected}
          className="tabpanel"
        >
          <ul className="agent-features">
            <Feature on={a.note} text="Start note" />
            <Feature on={a.capture} text="Request capture" />
            <Feature on={a.receipt} text="Receipt at session end" />
          </ul>
          <p>
            <InlineCode text={a.how} />
          </p>
        </div>
      ))}
    </div>
  );
}
