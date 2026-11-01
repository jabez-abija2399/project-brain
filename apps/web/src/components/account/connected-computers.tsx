"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { useState } from "react";

export type Computer = {
  id: string;
  projectId: string;
  projectName: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "never");

// Every CLI key on the user's projects, with revoke (asks once to confirm). Revoking uses the project's existing
// token route, which checks that the project is the user's own.
export function ConnectedComputers({ initial }: { initial: Computer[] }) {
  const [list, setList] = useState(initial);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function revoke(c: Computer) {
    setBusy(c.id);
    setMessage("");
    try {
      const r = await fetch(
        `/api/projects/${encodeURIComponent(c.projectId)}/tokens/${encodeURIComponent(c.id)}`,
        { method: "DELETE" },
      );
      if (!r.ok) throw new Error(String(r.status));
      setList((l) =>
        l.map((x) => (x.id === c.id ? { ...x, revokedAt: new Date().toISOString() } : x)),
      );
      setMessage(`Revoked. ${c.label ?? c.projectName} can no longer send receipts.`);
    } catch {
      setMessage("Could not revoke this key. Reload the page and try again.");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  if (list.length === 0) {
    return (
      <div className="empty" data-testid="empty-state">
        <h3 className="section-title">No computers connected</h3>
        <p className="muted">
          Run npx codeceipt in your app's folder and approve the code: that computer shows up here.
        </p>
      </div>
    );
  }
  return (
    <div className="stack">
      <table className="table">
        <caption>Keys for your projects, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Computer</th>
            <th scope="col">Project</th>
            <th scope="col">Created</th>
            <th scope="col">Last used</th>
            <th scope="col">
              <span className="lp-visually-hidden">Status or action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => (
            <tr key={c.id} data-token={c.id}>
              <td data-label="Computer" className="wrap">
                {c.label ?? "No name recorded"}
              </td>
              <td data-label="Project" className="wrap">
                {c.projectName}
              </td>
              <td data-label="Created">{day(c.createdAt)}</td>
              <td data-label="Last used">{day(c.lastUsedAt)}</td>
              <td data-label="">
                {c.revokedAt ? (
                  <StatusBadge status="neutral" label="Revoked" />
                ) : confirming === c.id ? (
                  <span className="row">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => revoke(c)}
                      disabled={busy === c.id}
                    >
                      {busy === c.id ? "Revoking…" : "Yes, revoke"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setConfirming(c.id)}
                    aria-label={`Revoke the key for ${c.label ?? c.projectName}`}
                  >
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <output aria-live="polite" className="muted">
        {message}
      </output>
    </div>
  );
}
