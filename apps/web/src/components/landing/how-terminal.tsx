"use client";

import { TICK_MS, totalTicks, visibleLines } from "@/lib/ui-helpers";
import { useEffect, useState } from "react";
import { STEPS, type TermLine } from "./content";

const PREFIX: Record<TermLine["kind"], string> = { cmd: "$ ", you: "> ", agent: "  ", out: "" };

// How it works: three step buttons and a terminal. A step plays only when you click it; with reduced motion it shows
// the finished output at once. The animated text is hidden from screen readers, which get the full transcript.
export function HowTerminal() {
  const [active, setActive] = useState(0);
  // null: the step's output is shown complete (the first step on load, so nothing plays by itself).
  const [tick, setTick] = useState<number | null>(null);
  const lines = STEPS[active]?.lines ?? [];
  const end = totalTicks(lines);

  useEffect(() => {
    if (tick === null) return;
    if (tick >= end) {
      setTick(null);
      return;
    }
    const t = setTimeout(() => setTick((n) => (n === null ? null : n + 1)), TICK_MS);
    return () => clearTimeout(t);
  }, [tick, end]);

  const play = (i: number) => {
    setActive(i);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setTick(reduced ? null : 0);
  };
  const shown = tick === null ? lines : visibleLines(lines, tick);
  const step = STEPS[active];

  return (
    <div className="how">
      <ol className="how-steps">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className="how-step"
              aria-pressed={i === active}
              aria-controls="how-terminal"
              onClick={() => play(i)}
            >
              <span className="how-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="how-step-text">
                <strong>{s.title}</strong>
                <span>{s.caption}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="terminal" id="how-terminal">
        <div className="terminal-bar" aria-hidden="true">
          <span />
          <span />
          <span />
          <em>{step?.title}</em>
        </div>
        <pre className="terminal-body" aria-hidden="true" data-playing={tick !== null}>
          {shown.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines of a fixed transcript, appended in order
            <span key={i} className={`t-${l.kind}`}>
              {PREFIX[l.kind]}
              {l.text}
              {"\n"}
            </span>
          ))}
          {tick !== null ? <span className="t-cursor" /> : null}
        </pre>
        <div className="lp-visually-hidden">
          <p>{`Terminal for step ${active + 1}, ${step?.title}:`}</p>
          <ul>
            {lines.map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines of a fixed transcript
              <li key={i}>{`${PREFIX[l.kind]}${l.text}`}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
