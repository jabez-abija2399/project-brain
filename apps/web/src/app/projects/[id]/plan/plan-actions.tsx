"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Approve the exact draft on screen: the request names its id and hash, and the server approves nothing if the agent
// replaced the draft since the page was loaded (409 plan_changed).
export function PlanActions({
  projectId,
  draftId,
  draftHash,
}: {
  projectId: string;
  draftId: string;
  draftHash: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function approve() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/plan/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draft_id: draftId, draft_hash: draftHash }),
      });
      if (res.ok) {
        setMessage("Approved. The features are on the Features tab.");
        router.refresh();
      } else if (res.status === 409) {
        setMessage(
          "The agent replaced this draft after you opened the page. Reload to see the new one.",
        );
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
    <div className="row">
      <Button variant="primary" loading={busy} disabled={busy} onClick={approve}>
        Approve this plan
      </Button>
      <output aria-live="polite" className="muted">
        {message}
      </output>
    </div>
  );
}
