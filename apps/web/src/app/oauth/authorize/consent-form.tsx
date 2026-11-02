"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

type Params = {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: "S256";
  resource: string;
  project_id: string;
};

// Allow or Deny for one project. The server checks the CSRF value against these exact fields and the signed-in user;
// the answer is the redirect back to the app (with a code, or with access_denied).
export function ConsentForm({ params, csrf }: { params: Params; csrf: string }) {
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [message, setMessage] = useState("");

  async function send(decision: "allow" | "deny") {
    setBusy(decision);
    setMessage("");
    try {
      const res = await fetch("/oauth/consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, ...params, csrf }),
      });
      if (res.ok) {
        const body = (await res.json()) as { redirect?: string };
        if (body.redirect) {
          window.location.assign(body.redirect);
          return;
        }
      }
      if (res.status === 403) setMessage("This page is out of date. Reload it and try again.");
      else if (res.status === 429) setMessage("Too many tries. Wait a minute and try again.");
      else setMessage("That did not work. Reload the page and try again.");
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <Button
          variant="primary"
          loading={busy === "allow"}
          disabled={busy !== null}
          onClick={() => send("allow")}
        >
          Allow
        </Button>
        <Button
          variant="secondary"
          loading={busy === "deny"}
          disabled={busy !== null}
          onClick={() => send("deny")}
        >
          Deny
        </Button>
      </div>
      <output aria-live="polite" className="muted">
        {message}
      </output>
    </div>
  );
}
