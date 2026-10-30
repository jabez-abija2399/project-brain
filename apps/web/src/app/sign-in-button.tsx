"use client";

import { useState } from "react";

// "link": a quiet "Sign in" for the landing page header and footer; the default is the full GitHub button.
// callbackURL: where to land after GitHub (a path on this site only, never another host).
export default function SignInButton({
  variant = "default",
  callbackURL = "/projects",
}: { variant?: "default" | "link"; callbackURL?: string }) {
  const target = /^\/(?!\/)[\w\-/?=&.%]*$/.test(callbackURL) ? callbackURL : "/projects";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "github", callbackURL: target }),
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

  if (variant === "link") {
    return (
      <span className="lp-signin">
        <button type="button" className="btn btn-ghost" onClick={signIn} disabled={busy}>
          {busy ? "Opening GitHub..." : "Sign in"}
        </button>
        {error ? (
          <span role="alert" className="lp-error">
            {error}
          </span>
        ) : null}
      </span>
    );
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
