"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

// Backlog: deleting a project from the dashboard (the API existed; only account deletion had a page). Destructive, so
// the owner types the project's name first (docs/DESIGN.md: destructive actions are confirmed).
export function DeleteProject({ projectId, name }: { projectId: string; name: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function remove() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
      });
      if (res.ok) {
        window.location.assign("/projects");
        return;
      }
      setMessage("The project could not be deleted. Reload the page and try again.");
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted m0">
        Deleting removes this project's receipts, plan, features and tokens for good. Your code is
        not touched. Type the project's name to confirm.
      </p>
      <label className="stack">
        <span>Project name</span>
        <input
          className="input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          aria-describedby="delete-project-help"
        />
      </label>
      <span id="delete-project-help" className="muted">
        Type: <strong className="wrap">{name}</strong>
      </span>
      <Button
        variant="danger"
        loading={busy}
        disabled={busy || typed !== name}
        onClick={() => void remove()}
      >
        Delete project
      </Button>
      {message ? (
        <p role="alert" className="m0">
          {message}
        </p>
      ) : null}
    </div>
  );
}
