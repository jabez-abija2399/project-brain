import { CopyCommand } from "@/components/copy-command";
import { ReceiptCard } from "@/components/receipt-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { onboarding } from "@/server/onboarding";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LiveStatus } from "./live-status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Get started | Codeceipt" };

// How to read a receipt, one line per section of the receipt card (journey part 1).
const RECEIPT_GUIDE: [string, string][] = [
  ["Asked", "the request you gave your agent, as you wrote it."],
  [
    "Checklist",
    "each part of that request: done, partly done or missed, judged from the files that changed.",
  ],
  ["Changed outside the request's feature", "files the agent touched beyond what you asked about."],
  [
    "Security findings",
    "possible secrets and database rules that need a look (secret values are never shown).",
  ],
  ["Test checks", "tests that were deleted, skipped or weakened during the session."],
  [
    "Not verified",
    "what Codeceipt could not check from the code alone, so you should try it yourself.",
  ],
];

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
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>
          {n}. {title}
        </h2>
        <StatusBadge status={done ? "done" : "open"} label={done ? "Done" : "Waiting"} />
      </div>
      {children}
    </li>
  );
}

// Journey part 1: the guided start page a new user sees after signing in. Each step turns done by itself (project
// linked, first index, first receipt); the first receipt is then shown with what each part means.
export default async function StartPage() {
  const user = await pageUser();
  const { project, steps, receipt } = await onboarding(getDb(), user);
  const allDone = steps.linked && steps.indexed && steps.receipt;
  const current = [steps.linked, steps.indexed, steps.receipt].map((d) => (d ? "1" : "0")).join("");
  const receipts = project ? `/projects/${project.id}/receipts` : null;
  return (
    <main className="page stack" style={{ maxWidth: 760 }}>
      <h1>Get your first receipt</h1>
      <p className="muted" style={{ margin: 0 }}>
        Three steps, about five minutes. Your code stays on your machine.
      </p>
      <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <Step n={1} done={steps.linked} title="Run npx codeceipt in your project">
          <p className="muted" style={{ margin: 0 }}>
            In your app's folder (a git repository), run:
          </p>
          <CopyCommand command="npx codeceipt" />
        </Step>
        <Step n={2} done={steps.indexed} title="Approve in the browser">
          <p className="muted" style={{ margin: 0 }}>
            A page opens with the same short code as your terminal. Check that the codes match, pick
            or create a project, and approve. Codeceipt then reads your code on your machine and
            sends only names and paths.
          </p>
        </Step>
        <Step n={3} done={steps.receipt} title="Open Claude Code or Cursor and make a change">
          <p className="muted" style={{ margin: 0 }}>
            Ask for something small, let the agent finish, then end the session. Your receipt
            appears here.
          </p>
        </Step>
      </ol>
      <LiveStatus on={!allDone} current={current} />
      {receipt && receipts ? (
        <section className="stack" aria-labelledby="first-receipt">
          <h2 id="first-receipt" style={{ fontSize: 18, margin: 0 }}>
            Your first receipt
          </h2>
          <ReceiptCard receipt={receipt} expanded />
          <h3 style={{ fontSize: 14, margin: 0 }}>How to read it</h3>
          <dl className="stack" style={{ margin: 0, gap: 6 }}>
            {RECEIPT_GUIDE.map(([term, meaning]) => (
              <div key={term}>
                <dt style={{ display: "inline", fontWeight: 600 }}>{term}: </dt>
                <dd style={{ display: "inline", margin: 0 }}>{meaning}</dd>
              </div>
            ))}
          </dl>
          <Link className="btn btn-primary" href={receipts} style={{ alignSelf: "flex-start" }}>
            Open all receipts
          </Link>
        </section>
      ) : null}
      <Link href="/projects?all=1">Skip to your projects</Link>
    </main>
  );
}
