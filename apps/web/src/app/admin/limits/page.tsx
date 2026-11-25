import { AdminNav } from "@/components/admin/admin-nav";
import { ClearUserLimits, DefaultLimitsForm, UserLimitsForm } from "@/components/admin/limits-form";
import { PageHeader } from "@/components/shell/page-header";
import { When } from "@/components/ui/when";
import { pageAdmin } from "@/server/admin";
import { limitsView } from "@/server/admin-limits";
import { betaLimitsOn } from "@/server/billing";
import { getDb } from "@/server/db";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Limits | Codeceipt", robots: { index: false } };

const words = (n: number | null) => (n === null ? "No limit" : String(n));

// FEAT-041: the beta limits, for the owners in ADMIN_GITHUB_LOGINS only (everyone else: the 404 page). The default
// limits for everyone, then the users with their own. Admins themselves have no project limit.
export default async function LimitsAdminPage() {
  const admin = await pageAdmin();
  const view = await limitsView(admin, getDb());
  return (
    <main className="page stack stack-lg">
      <PageHeader
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Limits" }]}
        title="Limits"
        purpose="How many projects and AI-checked receipts a month each account gets during the beta. Admins have no project limit."
      />
      <AdminNav current="/admin/limits" />
      {betaLimitsOn() ? null : (
        <p className="muted m0" data-testid="limits-off">
          The beta limits are off on this deployment (BETA_LIMITS is not "on"), so these numbers are
          saved but not applied.
        </p>
      )}
      {!view.ready ? (
        <section className="card stack" data-testid="limits-not-set-up">
          <h2 className="section-title m0">Not set up yet</h2>
          <p className="m0">
            Apply database migration 0058 to change limits. Until then everyone has the built-in
            limits: {view.defaults.projects} projects and {view.defaults.judgedPerMonth} AI-checked
            receipts a month.
          </p>
        </section>
      ) : (
        <>
          <section className="card stack" aria-labelledby="default-limits">
            <h2 id="default-limits" className="section-title m0">
              Default limits
            </h2>
            <p className="muted m0">
              Everyone without their own limits gets these. Leave a box empty for no limit.
            </p>
            <DefaultLimitsForm
              projects={view.defaults.projects}
              judgedPerMonth={view.defaults.judgedPerMonth}
            />
          </section>
          <section className="card stack" aria-labelledby="user-limits">
            <h2 id="user-limits" className="section-title m0">
              Give a user their own limits
            </h2>
            <p className="muted m0">
              Their limits win over the default. Leave a box empty for no limit.
            </p>
            <UserLimitsForm />
          </section>
          <section className="stack" aria-labelledby="user-limit-list">
            <h2 id="user-limit-list" className="section-title m0">
              Users with their own limits ({view.users.length})
            </h2>
            {view.users.length === 0 ? (
              <p className="muted m0">Nobody yet. Everyone has the default limits.</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Projects</th>
                      <th>AI-checked receipts a month</th>
                      <th>Changed</th>
                      <th>
                        <span className="lp-visually-hidden">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.users.map((u) => (
                      <tr key={u.userId} data-user-limit={u.userId}>
                        <td data-label="User">
                          <strong>{u.name}</strong>
                          <br />
                          <span className="muted">{u.email}</span>
                        </td>
                        <td data-label="Projects">{words(u.projects)}</td>
                        <td data-label="AI-checked receipts a month">{words(u.judgedPerMonth)}</td>
                        <td data-label="Changed">
                          <When iso={u.updatedAt} /> by {u.updatedBy}
                        </td>
                        <td data-label="Action">
                          <ClearUserLimits userId={u.userId} name={u.name} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
