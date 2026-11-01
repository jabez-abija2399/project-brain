import { AdminNav } from "@/components/admin/admin-nav";
import { PageHeader } from "@/components/shell/page-header";
import { pageAdmin } from "@/server/admin";
import { getDb } from "@/server/db";
import { MAX_PAGE_SIZE, waitlistRepo } from "@brain/db";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Waitlist | Codeceipt", robots: { index: false } };

// Launch part 5: the beta waitlist, for the owners in ADMIN_GITHUB_LOGINS only. Everyone else gets "not found", so
// the page does not reveal that it exists.
export default async function WaitlistAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  await pageAdmin();

  const raw = (await searchParams).page;
  const page = Math.min(
    Math.max(Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "1") : (raw ?? "1"), 10) || 1, 1),
    100_000,
  );
  const list = await waitlistRepo.list(getDb(), { offset: (page - 1) * MAX_PAGE_SIZE });
  return (
    <main className="page stack stack-lg">
      <PageHeader
        crumbs={[{ label: "Admin", href: "/admin" }, { label: "Waitlist" }]}
        title="Waitlist"
        purpose={`${list.total} ${list.total === 1 ? "email" : "emails"}, newest first.`}
        action={
          <a className="btn" href="/api/admin/waitlist" download>
            Download CSV
          </a>
        }
      />
      <AdminNav current="/admin/waitlist" />
      {list.items.length === 0 ? (
        <p className="muted">No emails on this page.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Joined</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((row) => (
              <tr key={row.id}>
                <td data-label="Email" className="mono wrap">
                  {row.email}
                </td>
                <td data-label="Joined">{row.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <nav aria-label="Pages" className="row">
        {page > 1 ? <Link href={`/admin/waitlist?page=${page - 1}`}>Newer</Link> : null}
        {list.nextOffset !== null ? (
          <Link href={`/admin/waitlist?page=${page + 1}`}>Older</Link>
        ) : null}
      </nav>
    </main>
  );
}
