"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { useState } from "react";
import { STATES, STATE_LINES, type StateKey } from "./content";
import { Paper } from "./receipt";

/** The receipt lines a state highlights. */
export function linesFor(state: StateKey) {
  return STATE_LINES.filter((l) => l.state === state);
}

// Read a receipt: pick a state and the matching lines light up, with one plain sentence about what it means.
// Highlighting is a data attribute on the receipt (CSS does the rest), so a click re-renders almost nothing.
export function ReceiptStates() {
  const [active, setActive] = useState<StateKey>("done");
  const meaning = STATES.find((s) => s.key === active);
  return (
    <div className="states">
      <div className="states-controls">
        <fieldset className="state-buttons" aria-label="Receipt states">
          {STATES.map((s) => (
            <button
              key={s.key}
              type="button"
              className="state-button"
              aria-pressed={s.key === active}
              aria-controls="states-receipt"
              onClick={() => setActive(s.key)}
            >
              <StatusBadge status={s.status} label={s.label} />
            </button>
          ))}
        </fieldset>
        <p className="state-meaning" aria-live="polite">
          <strong>{meaning?.label}:</strong> {meaning?.meaning}
        </p>
      </div>
      <div className="states-receipt" id="states-receipt" data-active={active}>
        <Paper>
          <div className="rc-head">
            <strong>Receipt</strong>
            <span>salon-booking</span>
          </div>
          <ul className="rc-list">
            {STATE_LINES.map((l) => {
              const s = STATES.find((x) => x.key === l.state);
              return (
                <li
                  key={l.state}
                  className="rc-line rc-annotated"
                  data-state={l.state}
                  data-match={l.state === active}
                >
                  {s ? <StatusBadge status={s.status} label={s.label} /> : null}
                  <span className="rc-text">
                    {l.text}
                    {l.path ? <span className="rc-path"> {l.path}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </Paper>
      </div>
    </div>
  );
}
