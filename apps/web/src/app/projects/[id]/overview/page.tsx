import { ActivityChart } from "@/components/activity-chart";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { projectOverview } from "@/server/overview";
import Link from "next/link";
import { ProjectNav } from "../project-nav";

export const dynamic = "force-dynamic";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The project overview (2026-11-01), the dashboard's front door: what needs attention and why first, then the week
// at a glance, the last 14 days, and progress per feature. Every number leads somewhere.
export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  const o = await orNotFound(() => projectOverview(getDb(), user, id));
  const base = `/projects/${o.project.id}`;
  const { week, attention, days } = o.stats;
  return (
    <main className="page stack" style={{ gap: 24 }}>
      <div>
        <ProjectNav projectId={o.project.id} current="overview" name={o.project.name} />
      </div>

      <section className="overview-hero" aria-labelledby="health">
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
              ? "Everything your agents did this week checks out"
              : "No receipts yet"}
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          {o.totalReceipts > 0
            ? `${plural(week.receipts, "receipt")} this week · ${plural(o.openItems, "open checklist item")}`
            : "Connect a repository and end an agent session: its receipt shows up here."}
        </p>
      </section>

      <div className="stat-grid">
        <StatCard
          id="attention"
          label="Needs attention"
          value={String(week.attention)}
          hint={week.attention > 0 ? "Receipts with something to fix" : "Nothing to fix this week"}
          href={`${base}/receipts`}
          tone={week.attention > 0 ? "danger" : "success"}
        />
        <StatCard
          id="missed"
          label="Open missed items"
          value={String(o.openMissed)}
          hint={o.openMissed > 0 ? "Still waiting on your agent" : "No missed items open"}
          href={`${base}/features`}
          tone={o.openMissed > 0 ? "warning" : "neutral"}
        />
        <StatCard
          id="done-rate"
          label="Done this week"
          value={week.doneRate === null ? "—" : `${week.doneRate}%`}
          hint={week.doneRate === null ? "Nothing judged yet" : "Of the checklist items judged"}
          href={`${base}/receipts`}
          tone={week.doneRate === null ? "neutral" : week.doneRate >= 80 ? "success" : "warning"}
        />
        <StatCard
          id="findings"
          label="Security findings"
          value={String(week.findings)}
          hint={week.findings > 0 ? "Secrets or open tables this week" : "None this week"}
          href={`${base}/receipts`}
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
              action={{ label: "Connect a repository", href: `${base}/connect` }}
            />
          )}
        </section>

        <section className="card stack" aria-labelledby="needs">
          <h3 id="needs" className="section-title">
            Needs your attention
          </h3>
          {attention.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nothing to fix. New receipts with missed items, findings or test checks show up here.
            </p>
          ) : (
            <ul className="attention-list">
              {attention.map((a) => (
                <li key={a.id}>
                  <Link href={`${base}/receipts#receipt-${a.id}`} className="attention-item">
                    <span className="attention-asked wrap">{a.asked ?? "No request recorded"}</span>
                    <span className="row" style={{ gap: 6 }}>
                      {a.reasons.map((r) => (
                        <StatusBadge key={r} status="missed" label={r} />
                      ))}
                    </span>
                    <time className="muted" dateTime={a.createdAt}>
                      {a.createdAt.slice(0, 16).replace("T", " ")} UTC
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {o.features.length > 0 && (
        <section className="card stack" aria-labelledby="progress">
          <h3 id="progress" className="section-title">
            Progress by feature
          </h3>
          <ul className="feature-progress">
            {o.features.map((f) => (
              <li key={f.id}>
                <span className="row" style={{ justifyContent: "space-between" }}>
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
