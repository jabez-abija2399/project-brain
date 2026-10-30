"use client";

import { type FormEvent, useId, useState } from "react";
import { normalizeWaitlistEmail } from "./waitlist-email";

export const WAITLIST_THANKS = "You're on the list. We'll email you when your invite is ready.";
const INVALID = "Enter an email address, for example you@example.com.";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Sends the email to the beta waitlist (launch part 5) and returns what to show under the form. */
export async function joinWaitlist(
  email: string,
  fetchImpl: Fetch = (url, init) => fetch(url, init),
): Promise<{ ok: boolean; message: string }> {
  const value = normalizeWaitlistEmail(email);
  if (!value) return { ok: false, message: INVALID };
  let res: Response;
  try {
    res = await fetchImpl("/api/waitlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: value }),
    });
  } catch {
    return { ok: false, message: "Could not reach the server. Try again." };
  }
  if (res.ok) return { ok: true, message: WAITLIST_THANKS };
  if (res.status === 429)
    return { ok: false, message: "Too many tries: wait a minute and try again." };
  if (res.status === 400) return { ok: false, message: INVALID };
  return { ok: false, message: "Something went wrong on our side. Try again later." };
}

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
