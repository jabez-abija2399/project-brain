"use client";

import { useState } from "react";

// Ends every session of this account (server side), then goes to the landing page.
export function SignOutEverywhere() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function go() {
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch("/api/account/sessions", { method: "DELETE" });
      if (!r.ok) throw new Error(String(r.status));
      window.location.href = "/";
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <div className="stack gap-6">
      <button type="button" className="btn self-start" onClick={go} disabled={busy}>
        {busy ? "Signing out…" : "Sign out of all sessions"}
      </button>
      {failed ? (
        <p role="alert" className="error-text m0">
          That did not work. Reload the page and try again.
        </p>
      ) : null}
    </div>
  );
}
