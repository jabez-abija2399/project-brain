"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

type View = {
  code: string | null;
  suggestedName: string | null;
  projects: { id: string; name: string }[];
};

// Approve exactly the code shown in the terminal, for one of the user's projects or a new one.
export function DeviceApproval({ initialCode, view }: { initialCode: string; view: View }) {
  const [code, setCode] = useState(view.code ?? initialCode);
  const [choice, setChoice] = useState(view.projects[0]?.id ?? "new");
  const [name, setName] = useState(view.suggestedName ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const [message, setMessage] = useState("");

  async function send(deny: boolean) {
    setBusy(true);
    setMessage("");
    const body = deny
      ? { user_code: code, deny: true }
      : choice === "new"
        ? { user_code: code, new_project_name: name }
        : { user_code: code, project_id: choice };
    try {
      const res = await fetch("/api/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) setDone(deny ? "denied" : "approved");
      else if (res.status === 404)
        setMessage("This code is wrong, used or expired. Run `npx codeceipt` again for a new one.");
      else if (res.status === 429) setMessage("Too many tries. Wait a minute and try again.");
      else if (res.status === 400) setMessage("Check the code (8 letters) and the project name.");
      else setMessage("That did not work. Reload the page and try again.");
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done === "approved") {
    return (
      <output className="card" style={{ display: "block" }}>
        Approved. Go back to your terminal: it finishes the setup on its own.
      </output>
    );
  }
  if (done === "denied") {
    return (
      <output className="card" style={{ display: "block" }}>
        Denied. Nothing was connected.
      </output>
    );
  }
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        void send(false);
      }}
    >
      <label className="stack" style={{ gap: 4 }}>
        <span>Code shown in your terminal</span>
        <input
          className="mono"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={9}
          autoComplete="off"
          required
          style={{ fontSize: 22, letterSpacing: 2, padding: 8 }}
        />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span>Connect this repo to</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)} style={{ padding: 8 }}>
          {view.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="new">A new project</option>
        </select>
      </label>
      {choice === "new" ? (
        <label className="stack" style={{ gap: 4 }}>
          <span>New project name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            style={{ padding: 8 }}
          />
        </label>
      ) : null}
      <p className="muted" style={{ margin: 0 }}>
        Only approve a code you started yourself with <code>npx codeceipt</code>.
      </p>
      <div className="row">
        <Button type="submit" variant="primary" loading={busy} disabled={busy || !code}>
          Approve
        </Button>
        <Button variant="ghost" disabled={busy || !code} onClick={() => send(true)}>
          Deny
        </Button>
      </div>
      <output aria-live="polite" className="muted">
        {message}
      </output>
    </form>
  );
}
