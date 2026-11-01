"use client";

import { useState } from "react";

// Suspend or restore a user or project. Asks once to confirm; the server checks the admin and writes the audit log.
export function SuspendButton({
  targetType,
  targetId,
  name,
  suspended,
}: {
  targetType: "user" | "project";
  targetId: string;
  name: string;
  suspended: boolean;
}) {
  const [state, setState] = useState(suspended);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const verb = state ? "Restore" : "Suspend";

  async function go() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/admin/suspend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType, targetId, suspended: !state }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setState(!state);
      setMessage(state ? `${name} is restored.` : `${name} is suspended.`);
    } catch {
      setMessage("That did not work. Reload the page and try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <span className="row">
      {confirming ? (
        <>
          <button
            type="button"
            className={`btn btn-sm ${state ? "" : "btn-danger"}`}
            onClick={go}
            disabled={busy}
          >
            {busy ? "Saving…" : `Yes, ${verb.toLowerCase()} ${targetType}`}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setConfirming(true)}
          aria-label={`${verb} ${targetType} ${name}`}
        >
          {verb}
        </button>
      )}
      <output aria-live="polite" className="muted">
        {message}
      </output>
    </span>
  );
}
