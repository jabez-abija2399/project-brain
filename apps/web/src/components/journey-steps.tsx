import type { ReactNode } from "react";
import { CopyCommand } from "./copy-command";
import { StatusBadge } from "./ui/status-badge";

// The first-time journey's three steps (start page and Connect tab), each done or waiting. data-step/data-status let
// tests and the live status read them.
function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <li data-step={n} data-status={done ? "done" : "waiting"} className="card stack">
      <div className="row between">
        <h2 className="section-title">
          {n}. {title}
        </h2>
        <StatusBadge status={done ? "done" : "open"} label={done ? "Done" : "Waiting"} />
      </div>
      {children}
    </li>
  );
}

export function JourneySteps({
  steps,
}: {
  steps: { linked: boolean; indexed: boolean; receipt: boolean };
}) {
  return (
    <ol className="stack plain-list">
      <Step n={1} done={steps.linked} title="Run npx codeceipt in your project">
        <p className="muted m0">In your app's folder (a git repository), run:</p>
        <CopyCommand command="npx codeceipt" />
      </Step>
      <Step n={2} done={steps.indexed} title="Approve in the browser">
        <p className="muted m0">
          A page opens with the same short code as your terminal. Check that the codes match, pick
          or create a project, and approve. Codeceipt then reads your code on your machine and sends
          only names and paths.
        </p>
      </Step>
      <Step n={3} done={steps.receipt} title="Open Claude Code or Cursor and make a change">
        <p className="muted m0">
          Ask for something small, let the agent finish, then end the session. Your receipt appears
          on the Receipts tab.
        </p>
      </Step>
    </ol>
  );
}
