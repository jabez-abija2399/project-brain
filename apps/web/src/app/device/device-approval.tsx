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
      else if (res.status === 403)
        setMessage(
          "Your account is suspended, so it cannot connect computers. See your Account page.",
        );
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
      <output className="card block result result-done">
        <strong>Approved.</strong> Go back to your terminal: it indexes your code and sets up your
        agents on its own. Your first receipt arrives after your next agent session.
      </output>
    );
  }
  if (done === "denied") {
    return (
      <output className="card block result">
        <strong>Denied.</strong> Nothing was connected. You can close this page.
      </output>
    );
  }
  return (
    <form
      className="card stack stack-lg"
      onSubmit={(e) => {
        e.preventDefault();
        void send(false);
      }}
    >
      <label className="device-code-box">
        <span className="muted">Code shown in your terminal (check that it matches)</span>
        <input
          className="device-code mono"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={9}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>
      <dl className="facts">
        <div>
          <dt>Which computer</dt>
          <dd>
            The terminal where you ran <code>npx codeceipt</code>
            {view.suggestedName ? (
              <>
                , in the folder <strong className="wrap">{view.suggestedName}</strong>
              </>
            ) : null}
            .
          </dd>
        </div>
        <div>
          <dt>What it gets</dt>
          <dd>A key that lets it send code-free evidence and receipts to one project.</dd>
        </div>
      </dl>
      <label className="field">
        <span>Which project</span>
        <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
          {view.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="new">A new project</option>
        </select>
      </label>
      {choice === "new" ? (
        <label className="field">
          <span>New project name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
          />
        </label>
      ) : null}
      <div className="next-steps">
        <strong>What happens next</strong>
        <ol className="m0 list-indent">
          <li>Your terminal indexes your code on your machine and sets up your agents.</li>
          <li>Work with your agent as usual and end the session.</li>
          <li>The receipt appears in the terminal and on the Receipts page.</li>
        </ol>
      </div>
      <p className="muted m0">
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
      <output aria-live="polite" className="error-text">
        {message}
      </output>
    </form>
  );
}
