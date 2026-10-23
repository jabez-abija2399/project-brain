"use client";

import { useState } from "react";

export default function SignInButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "github", callbackURL: "/projects" }),
      });
      // better-auth returns { url, redirect: true } for OAuth providers.
      const body = (await r.json().catch(() => ({}))) as {
        url?: string;
        message?: string;
      };
      if (r.ok && body.url) {
        window.location.href = body.url;
        return;
      }
      setError(body.message ?? "Could not start the sign-in flow");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 32 }}>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        style={{
          background: "var(--text)",
          color: "var(--surface)",
          border: 0,
          borderRadius: 8,
          padding: "12px 20px",
          fontSize: 15,
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Opening GitHub…" : "Sign in with GitHub"}
      </button>
      {error ? (
        <p role="alert" style={{ marginTop: 12, color: "var(--danger)", fontSize: 13 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
