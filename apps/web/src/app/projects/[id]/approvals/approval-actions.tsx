"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Roadmap Phase 6b: every button on the approvals page is one owner request to the approvals API. When the server
// says a change allows more than before (loosening) or that remembering needs a confirmation, the owner is asked and
// the same request is sent again with confirm: true. Only the owner's session reaches these routes.

const MESSAGES: Record<string, string> = {
  not_pending: "This request was already decided or has expired.",
  not_undoable: "Only an automatic approval can be undone, once.",
  policy_full: "Your policy already has 100 rules. Remove one first.",
  invalid_policy: "That policy is not valid; nothing was changed.",
};

export function ApprovalAction({
  projectId,
  path,
  method = "POST",
  body,
  label,
  done,
  variant = "secondary",
  ariaLabel,
}: {
  projectId: string;
  path: "" | "decide" | "undo" | "pause";
  method?: "POST" | "PUT";
  body: Record<string, unknown>;
  label: string;
  done: string;
  variant?: "primary" | "secondary" | "ghost";
  ariaLabel?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function send(confirm: boolean): Promise<void> {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/approvals${path ? `/${path}` : ""}`,
      {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(confirm ? { ...body, confirm: true } : body),
      },
    );
    if (res.ok) {
      setMessage(done);
      router.refresh();
      return;
    }
    const answer = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (
      res.status === 409 &&
      !confirm &&
      (answer.code === "confirm_loosening" || answer.code === "confirm_remember")
    ) {
      if (window.confirm(`${answer.message ?? "This allows more than before."} Continue?`)) {
        return send(true);
      }
      setMessage("Nothing was changed.");
      return;
    }
    setMessage(
      (answer.code && MESSAGES[answer.code]) ?? "That did not work. Reload the page and try again.",
    );
  }
  async function run() {
    setBusy(true);
    setMessage("");
    try {
      await send(false);
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="row">
      <Button variant={variant} onClick={run} loading={busy} aria-label={ariaLabel}>
        {label}
      </Button>
      {message ? <output className="muted">{message}</output> : null}
    </span>
  );
}
