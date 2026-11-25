"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// FEAT-041: the admin's limits forms. A blank number means no limit. The server checks the admin, the numbers and
// the user again; this form only collects them.
const toLimit = (v: string): number | null | "bad" => {
  const t = v.trim();
  if (t === "") return null;
  if (!/^\d{1,7}$/.test(t)) return "bad";
  return Number(t);
};

async function send(body: object): Promise<string | null> {
  const r = await fetch("/api/admin/limits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.ok) return null;
  const j = (await r.json().catch(() => ({}))) as { message?: string };
  return j.message ?? "That did not work. Reload the page and try again.";
}

function Numbers({
  projects,
  judged,
  onProjects,
  onJudged,
  idPrefix,
}: {
  projects: string;
  judged: string;
  onProjects: (v: string) => void;
  onJudged: (v: string) => void;
  idPrefix: string;
}) {
  return (
    <div className="row wrap">
      <label className="field" htmlFor={`${idPrefix}-projects`}>
        <span>Projects</span>
        <input
          id={`${idPrefix}-projects`}
          className="input"
          inputMode="numeric"
          placeholder="No limit"
          value={projects}
          onChange={(e) => onProjects(e.target.value)}
        />
      </label>
      <label className="field" htmlFor={`${idPrefix}-judged`}>
        <span>AI-checked receipts a month</span>
        <input
          id={`${idPrefix}-judged`}
          className="input"
          inputMode="numeric"
          placeholder="No limit"
          value={judged}
          onChange={(e) => onJudged(e.target.value)}
        />
      </label>
    </div>
  );
}

const show = (n: number | null) => (n === null ? "" : String(n));

export function DefaultLimitsForm({
  projects,
  judgedPerMonth,
}: { projects: number | null; judgedPerMonth: number | null }) {
  const router = useRouter();
  const [p, setP] = useState(show(projects));
  const [j, setJ] = useState(show(judgedPerMonth));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    const pp = toLimit(p);
    const jj = toLimit(j);
    if (pp === "bad" || jj === "bad") {
      setMessage("Use whole numbers, or leave a box empty for no limit.");
      return;
    }
    setBusy(true);
    const err = await send({ scope: "default", projects: pp, judgedPerMonth: jj });
    setBusy(false);
    setMessage(err ?? "Saved. Everyone without their own limits has these now.");
    if (!err) router.refresh();
  }
  return (
    <div className="stack">
      <Numbers projects={p} judged={j} onProjects={setP} onJudged={setJ} idPrefix="default" />
      <span className="row">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save default limits"}
        </button>
        <output aria-live="polite" className="muted">
          {message}
        </output>
      </span>
    </div>
  );
}

export function UserLimitsForm({ email: initial = "" }: { email?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initial);
  const [p, setP] = useState("");
  const [j, setJ] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    const pp = toLimit(p);
    const jj = toLimit(j);
    if (pp === "bad" || jj === "bad") {
      setMessage("Use whole numbers, or leave a box empty for no limit.");
      return;
    }
    setBusy(true);
    const err = await send({
      scope: "user",
      email: email.trim(),
      projects: pp,
      judgedPerMonth: jj,
    });
    setBusy(false);
    setMessage(err ?? `Saved. ${email.trim()} has these limits now.`);
    if (!err) router.refresh();
  }
  return (
    <div className="stack">
      <label className="field" htmlFor="user-email">
        <span>User's email</span>
        <input
          id="user-email"
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <Numbers projects={p} judged={j} onProjects={setP} onJudged={setJ} idPrefix="user" />
      <span className="row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={busy || !email.trim()}
        >
          {busy ? "Saving…" : "Give these limits"}
        </button>
        <output aria-live="polite" className="muted">
          {message}
        </output>
      </span>
    </div>
  );
}

export function ClearUserLimits({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <span className="row">
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        aria-label={`Back to the default limits: ${name}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const err = await send({ scope: "clear", userId });
          setBusy(false);
          if (err) setMessage(err);
          else router.refresh();
        }}
      >
        Use the default
      </button>
      <output aria-live="polite" className="muted">
        {message}
      </output>
    </span>
  );
}
