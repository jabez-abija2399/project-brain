import { AdminNav } from "@/components/admin/admin-nav";
import { PageHeader } from "@/components/shell/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { pageAdmin } from "@/server/admin";
import { adminAiUsage } from "@/server/admin-data";
import { getDb } from "@/server/db";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "AI usage | Admin | Codeceipt",
  robots: { index: false },
};

const usd = (n: number) => `$${n.toFixed(2)}`;

// AI usage (2026-11-01): calls and estimated cost per day and per project against the daily budget per project.
export default async function AdminAiPage() {
  const admin = await pageAdmin();
  const u = await adminAiUsage(admin, getDb());
  const days = [...u.perDay].reverse().filter((d) => d.calls > 0);
  return (
    <main className="page stack stack-lg">
      <PageHeader
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "AI usage" }]}
        title="AI usage"
        purpose={`Last 30 days. Each project may make ${u.budget} AI calls a day; cost is an estimate at ${usd(u.costPerCall)} a call.`}
      />
      <AdminNav current="/admin/ai" />
      <div className="stat-grid">
        <StatCard
          id="calls"
          label="AI calls, 30 days"
          value={String(u.total.calls)}
          hint="All projects"
        />
        <StatCard
          id="cost"
          label="Estimated cost, 30 days"
          value={usd(u.total.cost)}
          hint="Calls × estimate per call"
        />
        <StatCard
          id="at-budget"
          label="Projects that hit the budget"
          value={String(u.atBudget.length)}
          hint={u.atBudget.length > 0 ? "Listed below" : "None this month"}
          tone={u.atBudget.length > 0 ? "warning" : "neutral"}
        />
      </div>
      <section className="stack" aria-labelledby="projects">
        <h2 id="projects" className="section-title">
          Per project
        </h2>
        {u.projects.length === 0 ? (
          <div className="empty" data-testid="empty-state">
            <h3 className="section-title">No AI calls yet</h3>
            <p className="muted">
              Calls appear here when receipts, checklists or plans use the AI.
            </p>
          </div>
        ) : (
          <table className="table">
            <caption>Projects by AI calls, last 30 days</caption>
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Calls</th>
                <th scope="col">Estimated cost</th>
                <th scope="col">Busiest day</th>
                <th scope="col">Budget</th>
              </tr>
            </thead>
            <tbody>
              {u.projects.map((p) => (
                <tr key={p.projectId}>
                  <td data-label="Project" className="wrap">
                    {p.name}
                  </td>
                  <td data-label="Calls">{p.calls}</td>
                  <td data-label="Estimated cost">{usd(p.cost)}</td>
                  <td data-label="Busiest day">
                    {p.peak} of {u.budget}
                  </td>
                  <td data-label="Budget">
                    {p.daysAtBudget > 0 ? (
                      <StatusBadge
                        status="warning"
                        label={`Hit on ${p.daysAtBudget} day${p.daysAtBudget === 1 ? "" : "s"}`}
                      />
                    ) : (
                      <StatusBadge status="done" label="Within budget" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {days.length > 0 ? (
        <section className="stack" aria-labelledby="days">
          <h2 id="days" className="section-title">
            Per day
          </h2>
          <table className="table">
            <caption>Days with AI calls, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Calls</th>
                <th scope="col">Estimated cost</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td data-label="Day">{d.day}</td>
                  <td data-label="Calls">{d.calls}</td>
                  <td data-label="Estimated cost">{usd(d.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </main>
  );
}
