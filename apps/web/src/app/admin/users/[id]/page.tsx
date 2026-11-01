import { AdminNav } from "@/components/admin/admin-nav";
import { SuspendButton } from "@/components/admin/suspend-button";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { pageAdmin } from "@/server/admin";
import { adminUser } from "@/server/admin-data";
import { orNotFound } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "User | Admin | Codeceipt", robots: { index: false } };

// One user (2026-11-01): their projects with receipt counts, never receipt contents. Suspend or restore here.
export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await pageAdmin();
  const { id } = await params;
  const d = await orNotFound(() => adminUser(admin, getDb(), id));
  const self = d.user.id === admin.user.id;
  return (
    <main className="page stack stack-lg">
      <PageHeader
        crumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Users", href: "/admin/users" },
          { label: d.user.name },
        ]}
        title={d.user.name}
        purpose={`${d.user.email} · signed up ${d.user.createdAt.slice(0, 10)}`}
        action={
          self ? undefined : (
            <SuspendButton
              targetType="user"
              targetId={d.user.id}
              name={d.user.name}
              suspended={d.user.suspendedAt !== null}
            />
          )
        }
      />
      <AdminNav current="/admin/users" />
      <p className="m0">
        {d.user.suspendedAt ? (
          <StatusBadge status="missed" label={`Suspended ${d.user.suspendedAt.slice(0, 10)}`} />
        ) : (
          <StatusBadge status="done" label="Active" />
        )}
      </p>
      {d.projects.length === 0 ? (
        <div className="empty" data-testid="empty-state">
          <h2 className="section-title">No projects</h2>
          <p className="muted">This user signed in but has not connected a repository yet.</p>
        </div>
      ) : (
        <table className="table">
          <caption>Projects, newest first (receipt counts only)</caption>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Created</th>
              <th scope="col">Receipts</th>
              <th scope="col">Last receipt</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {d.projects.map((p) => (
              <tr key={p.id}>
                <td data-label="Project">
                  <span className="feature-cell">
                    <strong className="wrap">{p.name}</strong>
                    {p.repo ? <span className="muted wrap">{p.repo}</span> : null}
                  </span>
                </td>
                <td data-label="Created">{p.createdAt.slice(0, 10)}</td>
                <td data-label="Receipts">{p.receipts}</td>
                <td data-label="Last receipt">{p.lastReceiptAt?.slice(0, 10) ?? "none"}</td>
                <td data-label="Status">
                  <span className="row">
                    {p.suspendedAt ? (
                      <StatusBadge status="missed" label="Suspended" />
                    ) : (
                      <StatusBadge status="done" label="Active" />
                    )}
                    <SuspendButton
                      targetType="project"
                      targetId={p.id}
                      name={p.name}
                      suspended={p.suspendedAt !== null}
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
