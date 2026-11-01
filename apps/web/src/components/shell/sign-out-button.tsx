"use client";

import { useState } from "react";

// Signs out through better-auth's own endpoint, then goes to the landing page.
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signOut() {
    setBusy(true);
    setFailed(false);
    try {
      const r = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!r.ok) throw new Error(String(r.status));
      window.location.href = "/";
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <span className="signout">
      <button type="button" className="btn btn-ghost" onClick={signOut} disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed ? (
        <span role="alert" className="signin-error">
          Could not sign out. Try again.
        </span>
      ) : null}
    </span>
  );
}
