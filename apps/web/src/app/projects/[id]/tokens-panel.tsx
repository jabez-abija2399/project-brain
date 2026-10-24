"use client";

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
    <div>
      <button
        type="button"
        onClick={createToken}
        disabled={busy}
        style={{
          background: "var(--accent)",
          color: "var(--surface)",
          border: 0,
          borderRadius: 8,
          padding: "10px 16px",
          fontSize: 14,
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "Working…" : "Create token"}
      </button>

      {plaintext ? (
        <output
          style={{
            display: "block",
            marginTop: 12,
            padding: 12,
            background: "var(--surface)",
            border: "1px solid var(--warning)",
            borderRadius: 8,
            fontFamily: "JetBrains Mono, monospace",
            wordBreak: "break-all",
          }}
        >
          <strong>Copy this now — you won't see it again:</strong>
          <div style={{ marginTop: 8 }}>{plaintext}</div>
        </output>
      ) : null}

      {error ? (
        <p role="alert" style={{ marginTop: 12, color: "var(--danger)", fontSize: 13 }}>
          {error}
        </p>
      ) : null}

      {tokens.length === 0 ? (
        <p style={{ marginTop: 16, color: "var(--muted)" }}>No tokens yet.</p>
      ) : (
        <ul style={{ marginTop: 16, listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {tokens.map((t) => (
            <li
              key={t.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
              }}
            >
              <span style={{ fontFamily: "JetBrains Mono, monospace" }}>
                {t.id.slice(0, 8)} · created {new Date(t.createdAt).toLocaleDateString()} ·{" "}
                {t.revokedAt
                  ? "revoked"
                  : t.lastUsedAt
                    ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : "never used"}
              </span>
              {t.revokedAt ? null : (
                <button
                  type="button"
                  onClick={() => revoke(t.id)}
                  disabled={busy}
                  style={{
                    background: "transparent",
                    color: "var(--danger)",
                    border: "1px solid var(--danger)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 12,
                    cursor: busy ? "not-allowed" : "pointer",
                  }}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
