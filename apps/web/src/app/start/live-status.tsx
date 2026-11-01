"use client";

import { useEffect } from "react";

const EVERY_MS = 4000;
const STOP_AFTER_MS = 30 * 60 * 1000;

// Journey part 1: while a step is waiting, ask the server every few seconds and redraw the page when a step changes.
// Stops when every step is done, when the tab is hidden (resumes when shown) and after 30 minutes.
export function LiveStatus({ on, current }: { on: boolean; current: string }) {
  useEffect(() => {
    if (!on) return;
    const started = Date.now();
    let stopped = false;
    const tick = async () => {
      if (stopped || document.hidden || Date.now() - started > STOP_AFTER_MS) return;
      try {
        const res = await fetch("/api/onboarding", { cache: "no-store" });
        if (!res.ok) return;
        const { steps } = (await res.json()) as { steps: Record<string, boolean> };
        const next = [steps.linked, steps.indexed, steps.receipt]
          .map((d) => (d ? "1" : "0"))
          .join("");
        if (next !== current) window.location.reload();
      } catch {}
    };
    const timer = setInterval(tick, EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [on, current]);
  return (
    <p className="muted m0" data-live={on ? "on" : "off"} aria-live="polite">
      {on ? "This page updates by itself as each step finishes." : "All three steps are done."}
    </p>
  );
}
