"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Owner item 2 (2026-11-02): "Clean up open items" shows what it will close and merge (a dry run, nothing written),
// then "Run cleanup" performs exactly that. Owner only: the server answers 404 otherwise.
type Change = { id: string; text: string; kind: "close" | "merge" };
type Preview = { closed: number; merged: number; changes: Change[]; truncated: boolean };

export function OpenItemsCleanup({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "run" | null>(null);
  const [message, setMessage] = useState("");
  const url = `/api/projects/${encodeURIComponent(projectId)}/open-items/cleanup`;

  async function call(body?: { dryRun: true }) {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  async function showPreview() {
    setBusy("preview");
    setMessage("");
    try {
      setPreview((await call({ dryRun: true })) as Preview);
    } catch {
      setMessage("Could not load the preview. Reload the page and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    setBusy("run");
    setMessage("");
    try {
      const result = (await call()) as { closed: number; merged: number };
      setPreview(null);
      setMessage(`Closed ${result.closed}, merged ${result.merged}.`);
      router.refresh();
    } catch {
      setMessage("The cleanup did not run. Reload the page and try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!preview) {
    return (
      <span className="stack gap-4">
        <Button
          variant="ghost"
          loading={busy === "preview"}
          disabled={busy !== null}
          onClick={showPreview}
        >
          Clean up open items
        </Button>
        <output aria-live="polite" className="muted">
          {message}
        </output>
      </span>
    );
  }
  const total = preview.closed + preview.merged;
  return (
    <section className="stack gap-4" aria-label="Clean up preview">
      <p className="m0">
        Will close {preview.closed}, merge {preview.merged}:
      </p>
      {total === 0 ? (
        <p className="muted m0">Nothing to clean up.</p>
      ) : (
        <ul className="stack plain-list">
          {preview.changes.map((c) => (
            <li key={c.id} className="row">
              <span className="muted">{c.kind === "close" ? "Close" : "Merge"}:</span>
              <span className="wrap">{c.text}</span>
            </li>
          ))}
        </ul>
      )}
      {preview.truncated && <p className="muted m0">…and more, not listed here.</p>}
      <span className="row">
        {total > 0 && (
          <Button loading={busy === "run"} disabled={busy !== null} onClick={run}>
            Run cleanup
          </Button>
        )}
        <Button variant="ghost" disabled={busy !== null} onClick={() => setPreview(null)}>
          Cancel
        </Button>
      </span>
      <output aria-live="polite" className="muted">
        {message}
      </output>
    </section>
  );
}
