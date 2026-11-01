"use client";

import { joinWaitlist } from "@/lib/ui-helpers";
import { type FormEvent, useId, useState } from "react";

export function WaitlistForm() {
  const id = useId();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    setSending(true);
    setResult(await joinWaitlist(typeof email === "string" ? email : ""));
    setSending(false);
  }
  return (
    <form className="lp-form" onSubmit={submit} noValidate>
      <label htmlFor={`${id}-email`}>Email</label>
      <div className="lp-form-row">
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby={`${id}-result`}
          aria-invalid={result?.ok === false ? true : undefined}
          disabled={result?.ok === true}
        />
        <button type="submit" className="btn btn-primary" disabled={sending || result?.ok === true}>
          {sending ? "Joining..." : "Join the beta"}
        </button>
      </div>
      <output id={`${id}-result`} aria-live="polite" className="lp-form-result">
        {result?.message ?? ""}
      </output>
    </form>
  );
}
