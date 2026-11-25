"use client";

import { CELEBRATE_COOKIE } from "@/lib/celebrate";
import { useState } from "react";

// FEAT-033: turns the small celebrations (the done stamp, the first receipt printing) on or off for this browser.
export function CelebrateToggle({ on }: { on: boolean }) {
  const [enabled, setEnabled] = useState(on);
  function toggle() {
    const next = !enabled;
    // A display preference for a year; never sent to another site (SameSite=Lax, this site's path only).
    document.cookie = `${CELEBRATE_COOKIE}=${next ? "on" : "off"}; path=/; max-age=31536000; samesite=lax`;
    setEnabled(next);
    // Pages read it on the server, so the next load shows the change.
    window.location.reload();
  }
  return (
    <label className="row">
      <input type="checkbox" checked={enabled} onChange={toggle} />
      <span>Show small celebrations (a stamp on a receipt where everything was done)</span>
    </label>
  );
}
