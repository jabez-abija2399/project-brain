"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Shown = {
  proposedAt: string;
  change: { text: string; reason?: string } | { dismiss: true; reason?: string };
};

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
  // FEAT-035: rejecting asks "Why not? (optional)"; the answer reaches the agent.
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  async function decide(action: "confirm" | "reject") {
    setBusy(action);
    setMessage("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/checklist-items/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            [action]: true,
            proposal: shown,
            ...(action === "reject" && why.trim() ? { reason: why.trim() } : {}),
          }),
        },
      );
      if (res.ok) {
        setMessage(
          action === "confirm"
            ? "Confirmed."
            : why.trim()
              ? "Rejected. Your agent sees why next time it starts."
              : "Rejected.",
        );
        setAsking(false);
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
        onClick={() => (asking ? decide("reject") : setAsking(true))}
      >
        {asking ? "Reject it" : "Reject"}
      </Button>
      {asking ? (
        <label className="field why-not">
          <span>Why not? (optional)</span>
          <textarea
            className="input"
            rows={2}
            maxLength={500}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
          />
        </label>
      ) : null}
      <output aria-live="polite" className="muted">
        {message}
      </output>
    </div>
  );
}
