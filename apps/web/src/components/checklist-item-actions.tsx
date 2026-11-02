"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { nextDismissStep } from "./dismiss-step";

// H3 (2026-11-02): the owner's Close (done) and Dismiss buttons for one open item. Each accessible name includes the
// item's text, so a screen reader says which item it acts on. Owner only: the server answers 401/404 otherwise.
// Owner item 1 (2026-11-02): Dismiss asks first ("Confirm dismiss" or "Cancel"); Close needs no confirm.
const CLOSABLE = new Set(["open", "partial", "missed", "postponed"]);

export function ChecklistItemActions({
  projectId,
  itemId,
  text,
  status,
}: {
  projectId: string;
  itemId: string;
  text: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"close" | "dismiss" | null>(null);
  const [step, setStep] = useState<"idle" | "confirming">("idle");
  const [message, setMessage] = useState("");
  const url = `/api/projects/${encodeURIComponent(projectId)}/checklist-items/${encodeURIComponent(itemId)}`;
  async function act(action: "close" | "dismiss") {
    setBusy(action);
    setMessage("");
    try {
      const res =
        action === "close"
          ? await fetch(`${url}/close`, { method: "POST" })
          : await fetch(url, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ dismiss: true }),
            });
      if (res.ok) {
        router.refresh();
      } else {
        setMessage("That did not work. Reload the page and try again.");
      }
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
      setStep("idle");
    }
  }
  function onDismiss(event: "dismiss" | "confirm" | "cancel") {
    const next = nextDismissStep(step, event);
    setStep(next.step);
    if (next.send) void act("dismiss");
  }
  return (
    <span className="row">
      {CLOSABLE.has(status) && (
        <Button
          variant="ghost"
          aria-label={`Close: ${text}`}
          loading={busy === "close"}
          disabled={busy !== null}
          onClick={() => act("close")}
        >
          Close
        </Button>
      )}
      {step === "idle" && busy !== "dismiss" ? (
        <Button
          variant="ghost"
          aria-label={`Dismiss: ${text}`}
          disabled={busy !== null}
          onClick={() => onDismiss("dismiss")}
        >
          Dismiss
        </Button>
      ) : (
        <>
          <Button
            variant="ghost"
            loading={busy === "dismiss"}
            disabled={busy !== null}
            onClick={() => onDismiss("confirm")}
          >
            Confirm dismiss
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => onDismiss("cancel")}>
            Cancel
          </Button>
        </>
      )}
      <output aria-live="polite" className="muted">
        {message}
      </output>
    </span>
  );
}
