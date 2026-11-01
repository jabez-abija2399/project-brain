"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CreateProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setError(body?.fieldErrors?.name ?? body?.message ?? "Could not create project");
        return;
      }
      setName("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="inline-form">
      <label htmlFor="project-name">Or create an empty project</label>
      <div className="row">
        <input
          id="project-name"
          className="input"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Project name"
          maxLength={80}
          required
        />
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Creating…" : "Create project"}
        </button>
      </div>
      {error ? (
        <span className="error-text" role="alert">
          {error}
        </span>
      ) : null}
    </form>
  );
}
