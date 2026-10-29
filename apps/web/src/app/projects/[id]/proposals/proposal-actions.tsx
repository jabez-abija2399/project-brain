"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Shown = { proposedAt: string; change: { text: string } | { dismiss: true } };

// Confirm or reject the exact proposal on screen: the request carries it, and the server applies nothing if the agent
// replaced it since the page was loaded (409 proposal_changed).
export function ProposalActions({
  projectId,
  itemId,
  shown,
}: {
  projectId: string;
  itemId: string;
  shown: Shown;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);
  const [message, setMessage] = useState("");
  async function decide(action: "confirm" | "reject") {
    setBusy(action);
    setMessage("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/checklist-items/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ [action]: true, proposal: shown }),
        },
      );
      if (res.ok) {
        setMessage(action === "confirm" ? "Confirmed." : "Rejected.");
        router.refresh();
      } else if (res.status === 409) {
        setMessage(
          "The agent changed this proposal after you opened the page. Reload to see the new one.",
        );
      } else {
        setMessage("That did not work. Reload the page and try again.");
      }
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="row">
      <Button
        variant="primary"
        loading={busy === "confirm"}
        disabled={busy !== null}
        onClick={() => decide("confirm")}
      >
        Confirm
      </Button>
      <Button
        variant="ghost"
        loading={busy === "reject"}
        disabled={busy !== null}
        onClick={() => decide("reject")}
      >
        Reject
      </Button>
      <output aria-live="polite" className="muted">
        {message}
      </output>
    </div>
  );
}
