"use client";

import { useId, useState } from "react";

/** Whether the typed text matches the account name (what the delete button waits for). */
export function confirmMatches(typed: string, name: string): boolean {
  return typed.trim().length > 0 && typed.trim() === name.trim();
}

// Deleting the account: type the account name, then delete. The server checks the name again and deletes everything.
export function DeleteAccount({ name }: { name: string }) {
  const id = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const ok = confirmMatches(typed, name);

  async function remove() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: typed }),
      });
      if (r.ok) {
        window.location.href = "/?deleted=1";
        return;
      }
      setMessage(
        r.status === 400
          ? "The name does not match. Type it exactly as shown."
          : r.status === 429
            ? "Too many tries. Wait a minute and try again."
            : "That did not work. Reload the page and try again.",
      );
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) void remove();
      }}
    >
      <label htmlFor={`${id}-confirm`} className="field">
        <span>
          Type <strong className="mono">{name}</strong> to confirm
        </span>
        <input
          id={`${id}-confirm`}
          className="input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${id}-result`}
        />
      </label>
      <button type="submit" className="btn btn-danger-solid self-start" disabled={!ok || busy}>
        {busy ? "Deleting…" : "Delete my account forever"}
      </button>
      <output id={`${id}-result`} aria-live="polite" className="error-text">
        {message}
      </output>
    </form>
  );
}
