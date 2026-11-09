"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Roadmap Phase 3c: every Blueprint change on the page is one owner request to the Blueprint API with the version the
// page was loaded at, so a change made elsewhere in the meantime is refused (409) instead of overwritten.

const MESSAGES: Record<number, string> = {
  409: "The Blueprint changed since you opened this page. Reload to see the latest version.",
  413: "The Blueprint is full. Retire rules or test links you no longer need, then try again.",
};

export function BlueprintAction({
  projectId,
  path,
  body,
  label,
  done,
  variant = "secondary",
  confirm,
  ariaLabel,
}: {
  projectId: string;
  path: "" | "decide" | "restore";
  body: unknown;
  label: string;
  done: string;
  variant?: "primary" | "secondary" | "ghost";
  confirm?: string;
  // Tells repeated buttons apart for screen readers ("Accept: <the rule>").
  ariaLabel?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/blueprint${path ? `/${path}` : ""}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (res.ok) {
        setMessage(done);
        router.refresh();
      } else {
        setMessage(MESSAGES[res.status] ?? "That did not work. Reload the page and try again.");
      }
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="row">
      <Button variant={variant} loading={busy} disabled={busy} onClick={run} aria-label={ariaLabel}>
        {label}
      </Button>
      <output aria-live="polite" className="muted">
        {message}
      </output>
    </span>
  );
}

// "Do you usually read the code your AI writes?" The answer picks the view and is remembered in a cookie the server
// reads (a display preference only: it unlocks nothing). Switchable any time from the page.
export function ViewChoice({ current }: { current: "simple" | "detailed" | null }) {
  const router = useRouter();
  function pick(mode: "simple" | "detailed") {
    document.cookie = `codeceipt_view=${mode}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }
  if (current) {
    const other = current === "simple" ? "detailed" : "simple";
    return (
      <Button variant="ghost" onClick={() => pick(other)}>
        {other === "detailed" ? "Show every rule (Detailed)" : "Show the summary (Simple)"}
      </Button>
    );
  }
  return (
    <div className="card stack">
      <h2 className="section-title m0">Do you usually read the code your AI writes?</h2>
      <p className="muted m0">
        We will show the Blueprint the way that suits you. You can switch at any time.
      </p>
      <div className="row">
        <Button variant="primary" onClick={() => pick("simple")}>
          No, keep it simple
        </Button>
        <Button variant="secondary" onClick={() => pick("detailed")}>
          Yes, show me the details
        </Button>
      </div>
    </div>
  );
}
