import { isAdmin } from "@/server/admin";
import { getSessionUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { MAX_PAGE_SIZE, waitlistRepo } from "@brain/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Waitlist | Codeceipt", robots: { index: false } };

// Launch part 5: the beta waitlist, for the owners in ADMIN_GITHUB_LOGINS only. Everyone else gets "not found", so
// the page does not reveal that it exists.
export default async function WaitlistAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const req = new Request("http://localhost/", { headers: await headers() });
  const user = await getSessionUser(req);
  if (!user || !(await isAdmin(user, req))) notFound();

  const raw = (await searchParams).page;
  const page = Math.min(
    Math.max(Number.parseInt(Array.isArray(raw) ? (raw[0] ?? "1") : (raw ?? "1"), 10) || 1, 1),
    100_000,
  );
  const list = await waitlistRepo.list(getDb(), { offset: (page - 1) * MAX_PAGE_SIZE });
  return (
    <main className="page stack" style={{ maxWidth: 800 }}>
      <h1>Waitlist</h1>
      <p style={{ margin: 0, color: "var(--muted)" }}>
        {list.total} {list.total === 1 ? "email" : "emails"}, newest first.
      </p>
      {list.items.length === 0 ? (
        <p>No emails on this page.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Joined</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((row) => (
              <tr key={row.id}>
                <td className="mono">{row.email}</td>
                <td>{row.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <nav aria-label="Pages" style={{ display: "flex", gap: 16 }}>
        {page > 1 ? <Link href={`/admin/waitlist?page=${page - 1}`}>Newer</Link> : null}
        {list.nextOffset !== null ? (
          <Link href={`/admin/waitlist?page=${page + 1}`}>Older</Link>
        ) : null}
      </nav>
    </main>
  );
}
