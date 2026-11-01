import { JourneySteps } from "@/components/journey-steps";
import { ReceiptCard } from "@/components/receipt-card";
import { PageHeader } from "@/components/shell/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { onboarding } from "@/server/onboarding";
import type { Metadata } from "next";
import Link from "next/link";
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
  [
    "Done, no test proves it",
    "the change is in the code, but no test changed to show that it works.",
  ],
  ["Changed outside the request's feature", "files the agent touched beyond what you asked about."],
  [
    "Security findings",
    "possible secrets and database rules that need a look (secret values are never shown).",
  ],
  ["Test checks", "tests that were deleted, skipped or weakened during the session."],
  ["Not verified", "Codeceipt could not check this from the changed files, so try it yourself."],
];

// Journey part 1: the guided start page a new user sees after signing in. Each step turns done by itself (project
// linked, first index, first receipt); the first receipt is then shown with what each part means.
export default async function StartPage() {
  const user = await pageUser();
  const { project, steps, receipt } = await onboarding(getDb(), user);
  const allDone = steps.linked && steps.indexed && steps.receipt;
  const current = [steps.linked, steps.indexed, steps.receipt].map((d) => (d ? "1" : "0")).join("");
  const receipts = project ? `/projects/${project.id}/receipts` : null;
  const doneCount = [steps.linked, steps.indexed, steps.receipt].filter(Boolean).length;
  return (
    <main className="page page-narrow stack stack-lg">
      <PageHeader
        title={allDone ? "Your first receipt is here" : "Get your first receipt"}
        purpose={
          allDone
            ? "Every agent session from now on ends with a receipt like this one."
            : "Three steps, about five minutes. Your code stays on your machine."
        }
        action={
          receipts ? (
            <Link className="btn btn-primary" href={receipts}>
              Open all receipts
            </Link>
          ) : undefined
        }
      />
      {allDone ? (
        <output className="celebrate">
          <StatusBadge status="done" label="All 3 steps done" />
          <p className="m0">
            Codeceipt checked your agent's work against your request, from git. Read the receipt
            below; each part is explained under it.
          </p>
        </output>
      ) : (
        <div className="journey-progress">
          <ProgressBar done={doneCount} total={3} label={`${doneCount} of 3 steps done`} />
          <span className="muted">{doneCount} of 3 steps done</span>
        </div>
      )}
      <JourneySteps steps={steps} />
      <LiveStatus on={!allDone} current={current} />
      {receipt && receipts ? (
        <section className="stack" aria-labelledby="first-receipt">
          <h2 className="section-title" id="first-receipt">
            Your first receipt
          </h2>
          <ReceiptCard receipt={receipt} expanded />
          <h3 className="subhead">How to read it</h3>
          <dl className="guide">
            {RECEIPT_GUIDE.map(([term, meaning]) => (
              <div key={term}>
                <dt>{term}:</dt>
                <dd>{meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <Link className="self-start" href="/projects?all=1">
        Skip to your projects
      </Link>
    </main>
  );
}
