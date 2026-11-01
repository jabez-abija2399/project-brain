"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { useEffect, useState } from "react";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; repos: string[] };

export default function RepoPicker({ state }: { state: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [repo, setRepo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/github/repos?state=${encodeURIComponent(state)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok)
          setLoad({ kind: "error", message: body?.message ?? "Could not load repositories." });
        else setLoad({ kind: "ready", repos: body.repos ?? [] });
      })
      .catch(() =>
        setLoad({ kind: "error", message: "Could not load repositories. Check your connection." }),
      );
  }, [state]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const r = await fetch("/api/github/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state, repo }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(body?.message ?? "Could not link the repository. Start the GitHub install again.");
        return;
      }
      setLinked(body.repo);
    } finally {
      setSaving(false);
    }
  }

  if (load.kind === "loading") return <output>Loading repositories…</output>;
  if (load.kind === "error") {
    return (
      <p className="error-text" role="alert">
        {load.message} <a href="/projects">Back to projects</a>
      </p>
    );
  }
  if (linked) {
    return (
      <output className="block result result-done">
        <StatusBadge status="done" label="Linked" /> {linked}.{" "}
        <a href="/projects">Back to projects</a>
      </output>
    );
  }
  if (load.repos.length === 0) {
    return (
      <p className="muted">
        The installation has no repositories. Add one in GitHub, then start again from your project.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="stack stack-lg">
      <fieldset className="choice-list">
        <legend>Repository</legend>
        {load.repos.map((name) => (
          <label key={name} className="choice">
            <input
              type="radio"
              name="repo"
              value={name}
              checked={repo === name}
              onChange={() => setRepo(name)}
              required
            />{" "}
            {name}
          </label>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="error-text m0">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary self-start" disabled={saving || repo === ""}>
        {saving ? "Linking…" : "Link repository"}
      </button>
    </form>
  );
}
