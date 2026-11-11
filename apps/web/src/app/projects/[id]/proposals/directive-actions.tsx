"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Backlog: the owner confirms or dismisses a standing rule an agent proposed (until now confirm was API-only).
export function DirectiveActions({
  projectId,
  directiveId,
}: {
  projectId: string;
  directiveId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"active" | "dismissed" | null>(null);
  const [message, setMessage] = useState("");
  async function decide(status: "active" | "dismissed") {
    setBusy(status);
    setMessage("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/directives/${encodeURIComponent(directiveId)}`,
        status === "active"
          ? {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ status }),
            }
          : { method: "DELETE", headers: { "content-type": "application/json" } },
      );
      if (res.ok) {
        setMessage(status === "active" ? "Confirmed." : "Dismissed.");
        router.refresh();
      } else if (res.status === 409) {
        setMessage("This project already has as many rules as fit. Remove one first.");
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
    <div className="stack">
      <div className="row">
        <Button
          variant="primary"
          loading={busy === "active"}
          disabled={busy !== null}
          onClick={() => decide("active")}
        >
          Confirm
        </Button>
        <Button
          variant="ghost"
          loading={busy === "dismissed"}
          disabled={busy !== null}
          onClick={() => decide("dismissed")}
        >
          Dismiss
        </Button>
      </div>
      {message ? <output className="m0">{message}</output> : null}
    </div>
  );
}
