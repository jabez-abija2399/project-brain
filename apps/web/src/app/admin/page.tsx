import { AdminNav } from "@/components/admin/admin-nav";
import { PageHeader } from "@/components/shell/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { pageAdmin } from "@/server/admin";
import { adminOverview } from "@/server/admin-data";
import { getDb } from "@/server/db";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin | Codeceipt", robots: { index: false } };

const Check = ({ ok, label }: { ok: boolean; label: string }) => (
  <li className="row">
    <StatusBadge status={ok ? "done" : "missed"} label={ok ? "OK" : "Not set up"} />
    <span>{label}</span>
  </li>
);

// Admin overview (2026-11-01): the whole service at a glance. Counts only; no receipt contents or code.
export default async function AdminPage() {
  const admin = await pageAdmin();
  const o = await adminOverview(admin, getDb());
  const peak = Math.max(1, ...o.receiptsPerDay.map((d) => d.receipts));
  return (
    <main className="page stack stack-lg">
      <PageHeader
        title="Admin"
        purpose={`Signed in as ${admin.login}. The service at a glance; every action here is recorded in the audit log.`}
      />
      <AdminNav current="/admin" />
      <div className="stat-grid">
        <StatCard
          id="users"
          label="Users"
          value={String(o.users)}
          hint={`${o.suspended.users} suspended`}
          href="/admin/users"
        />
        <StatCard
          id="projects"
          label="Projects"
          value={String(o.projects)}
          hint={`${o.suspended.projects} suspended`}
        />
        <StatCard
          id="active"
          label="Active projects, 7 days"
          value={String(o.activeProjects7d)}
          hint="With a receipt this week"
        />
        <StatCard
          id="waitlist"
          label="Waitlist"
          value={String(o.waitlist)}
          hint="Emails waiting for an invite"
          href="/admin/waitlist"
        />
      </div>
      <div className="overview-grid">
        <section className="card stack" aria-labelledby="per-day">
          <h2 id="per-day" className="section-title">
            Receipts per day, last 30 days
          </h2>
          <ol className="mini-bars" aria-label="Receipts per day">
            {o.receiptsPerDay.map((d) => (
              <li
                key={d.day}
                aria-label={`${d.day}: ${d.receipts} receipts`}
                title={`${d.day}: ${d.receipts}`}
              >
                <span style={{ height: `${Math.round((d.receipts / peak) * 100)}%` }} />
              </li>
            ))}
          </ol>
          <p className="muted m0">
            {o.receiptsPerDay.reduce((n, d) => n + d.receipts, 0)} receipts in 30 days, at most{" "}
            {peak === 1 && o.receiptsPerDay.every((d) => d.receipts === 0) ? 0 : peak} a day.
          </p>
        </section>
        <section className="card stack" aria-labelledby="health">
          <h2 id="health" className="section-title">
            Health
          </h2>
          <ul className="plain-list stack gap-6">
            <Check ok={o.health.database} label="Database answers" />
            <Check ok={o.health.githubApp} label="GitHub App configured" />
            <Check ok={o.health.inngest} label="Inngest (background jobs) configured" />
            <Check ok={o.health.ai} label="AI configured" />
          </ul>
          <p className="muted m0">
            Checked {o.health.checkedAt.slice(0, 16).replace("T", " ")} UTC.
          </p>
        </section>
      </div>
    </main>
  );
}
