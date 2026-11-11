"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Roadmap Phase 10b: the owner's switch for receipts on pull requests (off by default). One owner request to the
// project's settings route; only the owner's session reaches it.
export function PrReceiptsToggle({ projectId, on }: { projectId: string; on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prReceipts: !on }),
      });
      if (res.ok) {
        setMessage(on ? "Turned off." : "Turned on.");
        router.refresh();
      } else {
        setMessage("That did not work. Reload the page and try again.");
      }
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="row wrap">
      <Button variant={on ? "secondary" : "primary"} onClick={run} loading={busy}>
        {on ? "Turn off receipts on pull requests" : "Turn on receipts on pull requests"}
      </Button>
      {message ? <output className="muted">{message}</output> : null}
    </span>
  );
}
