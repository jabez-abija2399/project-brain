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
    <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <label htmlFor="project-name" style={{ position: "absolute", left: -9999 }}>
        Project name
      </label>
      <input
        id="project-name"
        name="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="demo"
        maxLength={80}
        required
        style={{
          flex: 1,
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text)",
          fontSize: 14,
        }}
      />
      <button
        type="submit"
        disabled={submitting}
        style={{
          background: "var(--accent)",
          color: "var(--surface)",
          border: 0,
          borderRadius: 8,
          padding: "10px 16px",
          fontSize: 14,
          cursor: submitting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Creating…" : "Create project"}
      </button>
      {error ? (
        <span role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>
          {error}
        </span>
      ) : null}
    </form>
  );
}
