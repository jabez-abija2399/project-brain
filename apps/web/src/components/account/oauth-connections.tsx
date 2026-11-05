"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { useState } from "react";

export type Connection = {
  id: string;
  clientName: string;
  projectName: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "never");

// The apps connected by signing in (MCP OAuth). Revoking ends that app's access and refresh tokens at once.
export function OAuthConnections({ initial }: { initial: Connection[] }) {
  const [list, setList] = useState(initial);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function revoke(c: Connection) {
    setBusy(c.id);
    setMessage("");
    try {
      const r = await fetch(`/api/account/oauth-connections/${encodeURIComponent(c.id)}`, {
        method: "DELETE",
      });
      if (!r.ok) throw new Error(String(r.status));
      setList((l) =>
        l.map((x) => (x.id === c.id ? { ...x, revokedAt: new Date().toISOString() } : x)),
      );
      setMessage(`Revoked. ${c.clientName} can no longer reach ${c.projectName}.`);
    } catch {
      setMessage("Could not revoke this connection. Reload the page and try again.");
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  if (list.length === 0) {
    return (
      <div className="empty" data-testid="empty-state">
        <h3 className="section-title">No apps connected</h3>
        <p className="muted">
          When an app such as Claude Desktop, a claude.ai connector or VS Code asks to connect, you
          sign in here and approve one project. It shows up here.
        </p>
      </div>
    );
  }
  return (
    <div className="stack">
      <table className="table">
        <caption>Apps you connected by signing in, newest first</caption>
        <thead>
          <tr>
            <th scope="col">App</th>
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
            <tr key={c.id} data-connection={c.id}>
              <td data-label="App" className="wrap">
                {c.clientName}
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
                    aria-label={`Revoke the connection of ${c.clientName} to ${c.projectName}`}
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
