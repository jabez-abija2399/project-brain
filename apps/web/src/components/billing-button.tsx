"use client";

import { useState } from "react";

// Posts to a billing route (checkout or portal) and goes to the Stripe page it answers with. Signed out: sign in first.
export function BillingButton({
  action,
  plan,
  label,
  primary = false,
}: {
  action: "checkout" | "portal";
  plan?: string;
  label: string;
  primary?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/billing/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(plan ? { plan } : {}),
      });
      if (r.status === 401) {
        window.location.href = "/sign-in?next=/pricing";
        return;
      }
      const body = (await r.json().catch(() => ({}))) as { url?: string; message?: string };
      if (!r.ok || !body.url) throw new Error(body.message ?? "That did not work. Try again.");
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
      setBusy(false);
    }
  }
  return (
    <div className="stack gap-6">
      <button
        type="button"
        className={primary ? "btn btn-primary self-start" : "btn self-start"}
        onClick={go}
        disabled={busy}
      >
        {busy ? "Opening Stripe…" : label}
      </button>
      {error ? (
        <p role="alert" className="error-text m0">
          {error}
        </p>
      ) : null}
    </div>
  );
}
