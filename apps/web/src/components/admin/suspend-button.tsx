"use client";

import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [state, setState] = useState(suspended);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // FEAT-037: an optional reason, kept in the audit log.
  const [reason, setReason] = useState("");
  const verb = state ? "Restore" : "Suspend";

  async function go() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/admin/suspend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetType,
          targetId,
          suspended: !state,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setState(!state);
      setMessage(state ? `${name} is restored.` : `${name} is suspended.`);
      // FEAT-029: the page's status badges are server-rendered; refresh them now, not on the next reload.
      router.refresh();
    } catch {
      setMessage("That did not work. Reload the page and try again.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <span className="row wrap">
      {confirming ? (
        <span className="stack gap-6 suspend-confirm">
          <span className="wrap" data-testid="suspend-consequence">
            {state
              ? `Restore ${name}? Their dashboard, CLI and agents work again right away.`
              : targetType === "user"
                ? `Suspend ${name}? Their dashboard, CLI and agents stop working right away and they see the Suspended page. You can restore them any time.`
                : `Suspend ${name}? Its pages, CLI and agents stop working right away. You can restore it any time.`}
          </span>
          <label className="field">
            <span>Reason (optional, kept in the audit log)</span>
            <input
              className="input"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <span className="row">
            <button
              type="button"
              className={`btn btn-sm ${state ? "btn-primary" : "btn-danger"}`}
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
          </span>
        </span>
      ) : (
        <button
          type="button"
          className={`btn btn-sm ${state ? "btn-primary" : "btn-danger"}`}
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
