import { ActivityChart } from "@/components/activity-chart";
import { ChecklistItem } from "@/components/checklist-item";
import { OpenItemsCleanup } from "@/components/open-items-cleanup";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { When } from "@/components/ui/when";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { projectOverview } from "@/server/overview";
import Link from "next/link";
import { ProjectNav } from "../project-nav";

export const dynamic = "force-dynamic";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The project overview (2026-11-01), the dashboard's front door: what needs attention and why first, then the week
// at a glance, the last 14 days, and progress per feature. Every number leads somewhere.
// FEAT-030: where each next step lives now that the tabs are six (the step's page names stay as the CLI knows them).
const NEXT_LINK = {
  approvals: { path: "decide", label: "Open To decide" },
  plan: { path: "features#plan", label: "See the plan" },
  connect: { path: "settings", label: "Open Settings" },
  features: { path: "features", label: "Open Features" },
  blueprint: { path: "blueprint", label: "Open the Blueprint" },
  overview: { path: "overview", label: "Open the overview" },
} as const satisfies Record<string, { path: string; label: string }>;

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  const o = await orNotFound(() => projectOverview(getDb(), user, id));
  const base = `/projects/${o.project.id}`;
  const { week, attention, days } = o.stats;
  // FEAT-032: the list under the headline is this week's receipts (the same 7 days the headline counts).
  const now = new Date();
  const weekStart =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 6 * 86_400_000;
  const thisWeek = attention.filter((a) => new Date(a.createdAt).getTime() >= weekStart);
  return (
    <main className="page stack stack-lg">
      <div>
        <ProjectNav projectId={o.project.id} current="overview" name={o.project.name} />
      </div>

      {/* FEAT-032: the decision and the next step in one block, with one button. */}
      <section className="overview-hero stack" aria-labelledby="health">
        <StatusBadge
          status={week.attention > 0 ? "missed" : o.totalReceipts > 0 ? "done" : "neutral"}
          label={
            week.attention > 0
              ? "Needs attention"
              : o.totalReceipts > 0
                ? "All clear"
                : "Not started"
          }
        />
        <h2 id="health" className="overview-headline">
          {week.attention > 0
            ? `${plural(week.attention, "receipt needs", "receipts need")} your attention this week`
            : o.totalReceipts > 0
              ? "All clear. Everything your agents did this week checks out"
              : "No receipts yet"}
        </h2>
        <p className="muted m0">
          {o.totalReceipts > 0
            ? `${plural(week.receipts, "receipt")} this week · ${plural(o.openItems, "open checklist item")}`
            : "Connect a repository and end an agent session: its receipt shows up here."}
        </p>
        {/* Roadmap Phase 9: the one next step, the same one `codeceipt status` prints. */}
        <div className="stack gap-6" aria-labelledby="next-step">
          <h3 id="next-step" className="subhead m0">
            Next step
          </h3>
          <p className="m0">{o.next.text}</p>
          {o.next.command ? (
            <p className="muted m0">
              In the terminal: <code>{o.next.command}</code>
            </p>
          ) : null}
          {o.next.askAgent ? (
            <p className="muted m0">
              Ask your agent: <code>{o.next.askAgent}</code>
            </p>
          ) : null}
        </div>
        {week.attention > 0 ? (
          <Link className="btn btn-primary self-start" href={`${base}/receipts?filter=attention`}>
            Review {week.attention === 1 ? "it" : "them"}
          </Link>
        ) : o.next.page === "overview" ? null : (
          <Link
            className="btn btn-primary self-start"
            href={`${base}/${NEXT_LINK[o.next.page].path}`}
          >
            {NEXT_LINK[o.next.page].label}
          </Link>
        )}
      </section>

      <div className="stat-grid">
        <StatCard
          id="attention"
          label="Needs attention"
          value={String(week.attention)}
          hint={week.attention > 0 ? "Receipts with something to fix" : "Nothing to fix this week"}
          href={`${base}/receipts?filter=attention`}
          tone={week.attention > 0 ? "danger" : "success"}
        />
        <StatCard
          id="missed"
          label="Things your agent missed"
          value={String(o.openMissed)}
          hint={o.openMissed > 0 ? "Still not built" : "Nothing missed is open"}
          href={`${base}/receipts?filter=missed`}
          tone={o.openMissed > 0 ? "warning" : "neutral"}
        />
        <StatCard
          id="done-rate"
          label="Built as asked"
          value={week.doneRate === null ? "—" : `${week.doneRate}%`}
          hint={
            week.doneRate === null
              ? "Nothing checked yet this week"
              : `${week.doneRate}% of what you asked for this week`
          }
          href={`${base}/receipts?filter=good`}
          tone={week.doneRate === null ? "neutral" : week.doneRate >= 80 ? "success" : "warning"}
        />
        <StatCard
          id="findings"
          label="Security problems"
          value={String(week.findings)}
          hint={
            week.findings > 0
              ? "Passwords or keys in your code, or data anyone can read"
              : "None this week"
          }
          href={`${base}/receipts?filter=findings`}
          tone={week.findings > 0 ? "danger" : "neutral"}
        />
      </div>

      <div className="overview-grid">
        <section className="card stack" aria-labelledby="activity">
          <h3 id="activity" className="section-title">
            Last 14 days
          </h3>
          {o.totalReceipts > 0 ? (
            <ActivityChart days={days} />
          ) : (
            <EmptyState
              title="No receipts yet"
              text="End an agent session in a connected repository and its receipt appears here."
              action={{ label: "Connect a repository", href: `${base}/settings` }}
            />
          )}
        </section>

        <section className="card stack" aria-labelledby="needs">
          <h3 id="needs" className="section-title">
            This week's receipts to check
          </h3>
          {thisWeek.length === 0 ? (
            <p className="muted m0">
              Nothing to fix. New receipts with missed items, findings or test checks show up here.
            </p>
          ) : (
            <ul className="attention-list">
              {thisWeek.map((a) => (
                <li key={a.id}>
                  <Link href={`${base}/receipts#receipt-${a.id}`} className="attention-item">
                    <span className="attention-asked wrap">{a.asked ?? "No request recorded"}</span>
                    <span className="row gap-6">
                      {a.reasons.map((r) => (
                        <StatusBadge key={r} status="missed" label={r} />
                      ))}
                    </span>
                    <When className="muted" iso={a.createdAt} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {week.attention > thisWeek.length ? (
            <Link href={`${base}/receipts?filter=attention`}>
              and {week.attention - thisWeek.length} more in Receipts
            </Link>
          ) : null}
        </section>
      </div>

      <section className="card stack" aria-labelledby="open-items">
        <div className="row between">
          <h3 id="open-items" className="section-title">
            Open items
          </h3>
          <OpenItemsCleanup projectId={o.project.id} />
        </div>
        {o.openList.length === 0 ? (
          <p className="muted m0">No open items. Dismissed and closed items are not listed.</p>
        ) : (
          <ul className="stack plain-list">
            {o.openList.map((i) => (
              <ChecklistItem
                key={i.id}
                text={i.text}
                status={i.status}
                evidence={[]}
                action={{ projectId: o.project.id, itemId: i.id }}
              />
            ))}
          </ul>
        )}
      </section>

      {o.features.length > 0 && (
        <section className="card stack" aria-labelledby="progress">
          <h3 id="progress" className="section-title">
            Progress by feature
          </h3>
          <ul className="feature-progress">
            {o.features.map((f) => (
              <li key={f.id}>
                <span className="row between">
                  <strong className="wrap">{f.name}</strong>
                  <span className="muted">
                    {f.done} of {f.total} done
                    {f.open > 0 ? ` · ${f.open} open` : ""}
                  </span>
                </span>
                <ProgressBar
                  done={f.done}
                  total={f.total}
                  label={`${f.name}: ${f.done} of ${f.total} done`}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
