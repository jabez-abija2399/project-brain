"use client";

import { type FormEvent, useId, useState } from "react";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const WAITLIST_THANKS = "You're on the list. We'll email you when your invite is ready.";

/**
 * The beta waitlist's answer to an email. Stores and sends nothing yet: where the emails go is still to be decided
 * (agent/later.md), so the address never leaves the page.
 */
export function joinWaitlist(email: string): { ok: boolean; message: string } {
  const value = email.trim();
  if (value.length > 254 || !EMAIL.test(value)) {
    return { ok: false, message: "Enter an email address, for example you@example.com." };
  }
  return { ok: true, message: WAITLIST_THANKS };
}

export function WaitlistForm() {
  const id = useId();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get("email");
    setResult(joinWaitlist(typeof email === "string" ? email : ""));
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
        <button type="submit" className="btn btn-primary" disabled={result?.ok === true}>
          Join the beta
        </button>
      </div>
      <output id={`${id}-result`} aria-live="polite" className="lp-form-result">
        {result?.message ?? ""}
      </output>
    </form>
  );
}
