import { ReceiptCard } from "@/components/receipt-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { receiptsFeed } from "@/server/dashboard";
import { type ListPageProps, loadListPage } from "@/server/dashboard-page";
import { ProjectNav } from "../project-nav";

export const dynamic = "force-dynamic";

// Receipts feed (docs/DESIGN.md screen 1): newest first, 50 per page; the newest receipt opens expanded.
export default async function ReceiptsPage(props: ListPageProps) {
  const feed = await loadListPage(props, receiptsFeed);
  const base = `/projects/${feed.project.id}`;
  return (
    <main className="page">
      <ProjectNav projectId={feed.project.id} current="receipts" name={feed.project.name} />
      {feed.total === 0 ? (
        <EmptyState
          title="No receipts yet"
          text="A receipt appears when an agent session ends with changes for a request."
          action={{ label: "Set up your agent", href: `${base}/connect` }}
        />
      ) : (
        <>
          <ol className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {feed.rows.map((r, n) => (
              <li key={r.id}>
                <ReceiptCard receipt={r} expanded={feed.page === 1 && n === 0} />
              </li>
            ))}
          </ol>
          <Pagination page={feed.page} pages={feed.pages} basePath={`${base}/receipts`} />
        </>
      )}
    </main>
  );
}
