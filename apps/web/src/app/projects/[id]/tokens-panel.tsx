"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { useState } from "react";

type TokenRow = {
  id: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export default function ProjectTokensPanel({
  projectId,
  initialTokens,
}: {
  projectId: string;
  initialTokens: TokenRow[];
}) {
  const [tokens, setTokens] = useState<TokenRow[]>(initialTokens);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Revoking asks once to confirm (destructive actions need confirmation, docs/DESIGN.md).
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createToken() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/tokens`, { method: "POST" });
      if (!r.ok) {
        setError("Could not create token");
        return;
      }
      const body = (await r.json()) as {
        token: string;
        id: string;
        createdAt: string;
        lastUsedAt: string | null;
        revokedAt: string | null;
      };
      setPlaintext(body.token);
      setTokens((prev) => [
        {
          id: body.id,
          createdAt: body.createdAt,
          revokedAt: body.revokedAt,
          lastUsedAt: body.lastUsedAt,
        },
        ...prev,
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(tokenId: string) {
    if (!window.confirm("Revoke this token? Any machine using it will stop working.")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/tokens/${tokenId}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        setError("Could not revoke token");
        return;
      }
      setTokens((prev) =>
        prev.map((t) => (t.id === tokenId ? { ...t, revokedAt: new Date().toISOString() } : t)),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack-lg">
      <div>
        <button type="button" className="btn btn-primary" onClick={createToken} disabled={busy}>
          {busy ? "Working…" : "Create token"}
        </button>
      </div>

      {plaintext ? (
        <output className="token-once">
          <strong>Copy this now: you won't see it again.</strong>
          <code className="wrap">{plaintext}</code>
        </output>
      ) : null}

      {error ? (
        <p role="alert" className="error-text m0">
          {error}
        </p>
      ) : null}

      {tokens.length === 0 ? (
        <div className="empty" data-testid="empty-state">
          <h2 className="section-title">No tokens yet</h2>
          <p className="muted">
            Running npx codeceipt creates one for you; create one here only to connect by hand.
          </p>
        </div>
      ) : (
        <table className="table">
          <caption>Tokens for this project, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Token</th>
              <th scope="col">Created</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="lp-visually-hidden">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td data-label="Token">
                  <span className="mono">{t.id.slice(0, 8)}</span>
                </td>
                <td data-label="Created">{new Date(t.createdAt).toLocaleDateString()}</td>
                <td data-label="Status">
                  {t.revokedAt ? (
                    <StatusBadge status="missed" label="Revoked" />
                  ) : (
                    <StatusBadge
                      status="done"
                      label={
                        t.lastUsedAt
                          ? `Active, last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                          : "Active, never used"
                      }
                    />
                  )}
                </td>
                <td data-label="">
                  {t.revokedAt ? null : confirming === t.id ? (
                    <span className="row">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          setConfirming(null);
                          void revoke(t.id);
                        }}
                        disabled={busy}
                      >
                        Yes, revoke
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
                      className="btn btn-danger btn-sm"
                      onClick={() => setConfirming(t.id)}
                      disabled={busy}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
