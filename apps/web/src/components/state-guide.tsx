"use client";

import { STATES } from "@/components/landing/content";
import { useEffect, useRef } from "react";
import { StatusBadge } from "./ui/status-badge";

const SEEN = "codeceipt.stateGuide.closed";

// What each receipt state means, in one plain sentence each. Open on first view; once closed it stays closed in
// this browser (a convenience only: reading it never depends on storage).
export function StateGuide() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN) === "1" && ref.current) ref.current.open = false;
    } catch {}
  }, []);
  return (
    <details
      ref={ref}
      className="state-guide"
      open
      onToggle={(e) => {
        try {
          window.localStorage.setItem(SEEN, e.currentTarget.open ? "0" : "1");
        } catch {}
      }}
    >
      <summary>What the states on a receipt mean</summary>
      <dl>
        {STATES.map((s) => (
          <div key={s.key}>
            <dt>
              <StatusBadge status={s.status} label={s.label} />
            </dt>
            <dd>{s.meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
