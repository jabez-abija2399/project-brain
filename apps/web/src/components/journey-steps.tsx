import type { ReactNode } from "react";
import { CopyCommand } from "./copy-command";
import { CopyButton } from "./ui/copy-button";
import { StatusBadge } from "./ui/status-badge";

// The first-time journey's three steps (start page and Connect), each done or waiting. data-step/data-status let
// tests and the live status read them. FEAT-031: exactly one step is current (the first one not done): it says
// what it is waiting for; later steps are dimmed until their turn.
type State = "done" | "current" | "later";

function Step({
  n,
  state,
  title,
  waiting,
  children,
}: {
  n: number;
  state: State;
  title: string;
  waiting: string;
  children: ReactNode;
}) {
  const done = state === "done";
  return (
    <li
      data-step={n}
      data-status={done ? "done" : "waiting"}
      data-current={state === "current" ? "true" : undefined}
      aria-current={state === "current" ? "step" : undefined}
      className={`card stack journey-step journey-step-${state}`}
    >
      <div className="row between">
        <h2 className="section-title">
          {n}. {title}
        </h2>
        <StatusBadge status={done ? "done" : "open"} label={done ? "Done" : "Waiting"} />
      </div>
      {state === "current" ? (
        <p className="m0 journey-waiting">
          <span className="journey-dot" aria-hidden="true" />
          {waiting}
        </p>
      ) : null}
      {done ? null : children}
    </li>
  );
}

// The easy way for people who have never used a terminal: let the agent run it.
const AGENT_PROMPT = "Run npx codeceipt in this project and tell me the code it shows.";

function TerminalHelp() {
  return (
    <details className="terminal-help">
      <summary>Never used a terminal?</summary>
      <div className="stack">
        <p className="m0">
          <strong>Easiest:</strong> paste this into Claude Code or Cursor, and the agent runs it for
          you:
        </p>
        <p className="row wrap m0">
          <q className="wrap">{AGENT_PROMPT}</q>
          <CopyButton label="Copy" text={AGENT_PROMPT} />
        </p>
        <p className="m0">
          <strong>Or open a terminal yourself:</strong>
        </p>
        <ul className="m0 list-indent stack">
          <li>Mac: open the Terminal app. Windows: open PowerShell.</li>
          <li>In Cursor or VS Code: menu View, then Terminal (it opens in your app's folder).</li>
          <li>
            Type <code>cd </code> (with a space), drag your app's folder onto the window, press
            Enter, then paste the command above.
          </li>
          <li>
            If it says <code>npx: command not found</code>, install Node.js from nodejs.org first.
          </li>
        </ul>
      </div>
    </details>
  );
}

export function JourneySteps({
  steps,
}: {
  steps: { linked: boolean; indexed: boolean; receipt: boolean };
}) {
  const done = [steps.linked, steps.indexed, steps.receipt];
  const current = done.indexOf(false);
  const state = (i: number): State => (done[i] ? "done" : i === current ? "current" : "later");
  return (
    <ol className="stack plain-list">
      <Step
        n={1}
        state={state(0)}
        title="Connect this computer"
        waiting="Waiting for you to run the command and approve the code in your browser…"
      >
        <p className="muted m0">
          In your app's folder, run this command, then approve the code in the page that opens:
        </p>
        <CopyCommand command="npx codeceipt" />
        <TerminalHelp />
      </Step>
      <Step
        n={2}
        state={state(1)}
        title="Codeceipt reads your project"
        waiting="Waiting for Codeceipt to finish reading your project (about a minute)…"
      >
        <p className="muted m0">
          After you approve, Codeceipt reads your code on your computer and sends only names and
          paths. This takes a minute and needs nothing from you.
        </p>
      </Step>
      <Step
        n={3}
        state={state(2)}
        title="Get your first receipt"
        waiting="Waiting for your agent's first session to end. It usually shows within a minute of the agent finishing…"
      >
        <p className="muted m0">
          Open Claude Code or Cursor, ask for something small, let the agent finish, then end the
          session. Your receipt appears here and on the Receipts tab.
        </p>
      </Step>
    </ol>
  );
}
