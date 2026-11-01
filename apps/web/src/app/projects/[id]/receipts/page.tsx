import { ReceiptCard } from "@/components/receipt-card";
import { ReceiptsFilter, dayLabel } from "@/components/receipts-filter";
import { StateGuide } from "@/components/state-guide";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { receiptsFeed } from "@/server/dashboard";
import { type ListPageProps, loadListPage } from "@/server/dashboard-page";
import { NO_REQUEST_NOTE, receiptNeedsAttention } from "@brain/core";
import { ProjectNav } from "../project-nav";

export const dynamic = "force-dynamic";

// Receipts feed (docs/DESIGN.md screen 1): newest first, 50 per page, under day headings; the newest receipt opens
// expanded. Chips, search and keyboard shortcuts filter it in the browser.
export default async function ReceiptsPage(props: ListPageProps) {
  const feed = await loadListPage(props, receiptsFeed);
  const base = `/projects/${feed.project.id}`;
  const now = new Date();
  let lastDay = "";
  return (
    <main className="page stack stack-lg">
      <ProjectNav projectId={feed.project.id} current="receipts" name={feed.project.name} />
      {feed.total === 0 ? (
        <EmptyState
          title="No receipts yet"
          text="A receipt for each agent session appears here once you make a change with Claude Code, Cursor, Codex, OpenCode or Antigravity and end the session."
          action={{ label: "Get started", href: "/start" }}
        />
      ) : (
        <>
          <StateGuide />
          <ReceiptsFilter
            total={feed.rows.length}
            attention={feed.rows.filter((r) => receiptNeedsAttention(r.view)).length}
          >
            <ol className="stack plain-list">
              {feed.rows.flatMap((r, n) => {
                const day = dayLabel(r.createdAt, now);
                const heading =
                  day !== lastDay ? (
                    <li key={`day-${day}`} className="day-heading">
                      <h2 className="section-title">{day}</h2>
                    </li>
                  ) : null;
                lastDay = day;
                return [
                  heading,
                  <li
                    key={r.id}
                    data-attention={receiptNeedsAttention(r.view)}
                    data-search={(r.view.noRequest
                      ? NO_REQUEST_NOTE
                      : (r.asked ?? "")
                    ).toLowerCase()}
                  >
                    <ReceiptCard receipt={r} expanded={feed.page === 1 && n === 0} />
                  </li>,
                ];
              })}
            </ol>
          </ReceiptsFilter>
          <Pagination page={feed.page} pages={feed.pages} basePath={`${base}/receipts`} />
        </>
      )}
    </main>
  );
}
