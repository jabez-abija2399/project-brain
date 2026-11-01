import { AdminNav } from "@/components/admin/admin-nav";
import { PageHeader } from "@/components/shell/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { pageAdmin } from "@/server/admin";
import { adminUsers } from "@/server/admin-data";
import { getDb } from "@/server/db";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Users | Admin | Codeceipt", robots: { index: false } };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Admin users (2026-11-01): newest first, 50 a page, searchable by name or email.
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const admin = await pageAdmin();
  const sp = await searchParams;
  const q = (one(sp.q) ?? "").slice(0, 100);
  const list = await adminUsers(admin, getDb(), { search: q, page: Number(one(sp.page) ?? "1") });
  return (
    <main className="page stack stack-lg">
      <PageHeader
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Users" }]}
        title="Users"
        purpose="Everyone who signed in, with their projects, receipts and last activity."
      />
      <AdminNav current="/admin/users" />
      <form className="row" aria-label="Search users" action="/admin/users">
        <label htmlFor="q" className="lp-visually-hidden">
          Search users by name or email
        </label>
        <input
          id="q"
          name="q"
          type="search"
          className="search"
          defaultValue={q}
          placeholder="Search name or email…"
        />
        <button type="submit" className="btn">
          Search
        </button>
      </form>
      {list.rows.length === 0 ? (
        <div className="empty" data-testid="empty-state">
          <h2 className="section-title">{q ? "No users match" : "No users yet"}</h2>
          <p className="muted">
            {q
              ? "Try part of a name or an email address."
              : "People appear here after they sign in with GitHub."}
          </p>
        </div>
      ) : (
        <table className="table">
          <caption>{list.total} users, newest first</caption>
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Signed up</th>
              <th scope="col">Projects</th>
              <th scope="col">Receipts</th>
              <th scope="col">Last activity</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((u) => (
              <tr key={u.id}>
                <td data-label="User">
                  <span className="feature-cell">
                    <Link href={`/admin/users/${encodeURIComponent(u.id)}`} className="wrap">
                      {u.name}
                    </Link>
                    <span className="muted wrap">{u.email}</span>
                  </span>
                </td>
                <td data-label="Signed up">{u.createdAt.slice(0, 10)}</td>
                <td data-label="Projects">{u.projects}</td>
                <td data-label="Receipts">{u.receipts}</td>
                <td data-label="Last activity">{u.lastActivity?.slice(0, 10) ?? "never"}</td>
                <td data-label="Status">
                  {u.suspendedAt ? (
                    <StatusBadge status="missed" label="Suspended" />
                  ) : (
                    <StatusBadge status="done" label="Active" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Pagination
        page={list.page}
        pages={list.pages}
        basePath="/admin/users"
        query={q ? `q=${encodeURIComponent(q)}` : undefined}
      />
    </main>
  );
}
