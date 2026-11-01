import { AdminNav } from "@/components/admin/admin-nav";
import { PageHeader } from "@/components/shell/page-header";
import { pageAdmin } from "@/server/admin";
import { auditLog } from "@/server/admin-data";
import { getDb } from "@/server/db";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Audit log | Admin | Codeceipt",
  robots: { index: false },
};

// The audit log (2026-11-01): every admin action, newest first. Read-only here; the database refuses changes.
export default async function AdminAuditPage() {
  const admin = await pageAdmin();
  const rows = await auditLog(admin, getDb());
  return (
    <main className="page stack stack-lg">
      <PageHeader
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Audit log" }]}
        title="Audit log"
        purpose="Every admin action: who, what, when and to which user or project. It cannot be edited or deleted."
      />
      <AdminNav current="/admin/audit" />
      {rows.length === 0 ? (
        <div className="empty" data-testid="empty-state">
          <h2 className="section-title">No admin actions yet</h2>
          <p className="muted">
            Suspending, restoring and exporting the waitlist are recorded here.
          </p>
        </div>
      ) : (
        <table className="table">
          <caption>The newest 200 actions</caption>
          <thead>
            <tr>
              <th scope="col">When (UTC)</th>
              <th scope="col">Admin</th>
              <th scope="col">Action</th>
              <th scope="col">Target</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="When">{r.at.slice(0, 16).replace("T", " ")}</td>
                <td data-label="Admin">{r.admin}</td>
                <td data-label="Action">{r.action.replaceAll("_", " ")}</td>
                <td data-label="Target" className="mono wrap">
                  {r.target}
                </td>
                <td data-label="Detail" className="wrap">
                  {r.detail ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
