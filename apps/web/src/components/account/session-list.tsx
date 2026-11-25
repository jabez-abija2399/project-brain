"use client";

import { formatRelative } from "@/lib/when";

import { useState } from "react";

export type BrowserSession = { id: string; label: string; since: string; lastUsed: string };

const day = (iso: string) => formatRelative(iso);

// Backlog: the account's signed-in browsers, each with its own "Sign out". Ending this browser's own session signs
// it out on the next page load.
export function SessionList({
  sessions,
  current = null,
}: { sessions: BrowserSession[]; current?: string | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function end(id: string) {
    setBusy(id);
    setFailed(false);
    try {
      const r = await fetch(`/api/account/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(String(r.status));
      window.location.reload();
    } catch {
      setFailed(true);
      setBusy(null);
    }
  }
  if (sessions.length === 0) return null;
  return (
    <div className="stack gap-6">
      <ul className="stack gap-6 plain-list">
        {[...sessions]
          .sort((a, b) => Number(b.id === current) - Number(a.id === current))
          .map((s) => (
            <li key={s.id} className="row between">
              <span>
                {s.label}{" "}
                {s.id === current ? (
                  <span className="badge badge-done" data-testid="this-browser">
                    This browser
                  </span>
                ) : null}{" "}
                <span className="muted">
                  (signed in {day(s.since)}, last used {day(s.lastUsed)})
                </span>
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => end(s.id)}
                disabled={busy !== null}
                aria-label={`Sign out ${s.label}, signed in ${day(s.since)}`}
              >
                {busy === s.id ? "Signing out…" : "Sign out"}
              </button>
            </li>
          ))}
      </ul>
      {failed ? (
        <p role="alert" className="error-text m0">
          That did not work. Reload the page and try again.
        </p>
      ) : null}
    </div>
  );
}
