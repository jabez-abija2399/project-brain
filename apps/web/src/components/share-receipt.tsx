"use client";

import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { useState } from "react";

// FEAT-021: the owner's Share control for one receipt: make a read-only link (shown once, with Copy) and revoke the
// active ones. Owner only: the server answers 401/404 otherwise.
export function ShareReceipt({
  projectId,
  receiptId,
  links,
}: {
  projectId: string;
  receiptId: string;
  links: { id: string; createdAt: string }[];
}) {
  // The active links, kept here so the control needs no page reload (and no router).
  const [active, setActive] = useState(links);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const project = `/api/projects/${encodeURIComponent(projectId)}`;
  async function create() {
    setBusy("create");
    setMessage("");
    try {
      const res = await fetch(`${project}/receipts/${encodeURIComponent(receiptId)}/share`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as {
        link?: { id?: string; url?: string; createdAt?: string };
        message?: string;
      };
      if (res.ok && typeof body.link?.url === "string" && typeof body.link.id === "string") {
        setUrl(body.link.url);
        const created = { id: body.link.id, createdAt: body.link.createdAt ?? "" };
        setActive((list) => [created, ...list]);
      } else {
        setMessage(body.message ?? "That did not work. Reload the page and try again.");
      }
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }
  async function revoke(linkId: string) {
    setBusy(linkId);
    setMessage("");
    try {
      const res = await fetch(`${project}/share-links/${encodeURIComponent(linkId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setUrl(null);
        setActive((list) => list.filter((l) => l.id !== linkId));
      } else setMessage("That did not work. Reload the page and try again.");
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="stack gap-6">
      <div className="row">
        <Button
          variant="ghost"
          loading={busy === "create"}
          disabled={busy !== null}
          onClick={create}
        >
          Share a read-only link
        </Button>
        {active.map((l, n) => (
          <Button
            key={l.id}
            variant="ghost"
            aria-label={`Revoke share link ${n + 1}`}
            loading={busy === l.id}
            disabled={busy !== null}
            onClick={() => revoke(l.id)}
          >
            Revoke link {active.length > 1 ? n + 1 : ""}
          </Button>
        ))}
      </div>
      {url && (
        <p className="row wrap">
          <code className="wrap">{url}</code>
          <CopyButton text={url} label="Copy link" />
          <span className="muted">Shown once: anyone with this link can see this receipt.</span>
        </p>
      )}
      {message && (
        <p role="status" className="muted">
          {message}
        </p>
      )}
    </div>
  );
}
