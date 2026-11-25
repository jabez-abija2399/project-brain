import { ReceiptCard } from "@/components/receipt-card";
import { ReceiptsFilter } from "@/components/receipts-filter";
import { ShareReceipt } from "@/components/share-receipt";
import { StateGuide } from "@/components/state-guide";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { FILTERS } from "@/lib/receipt-filters";
import { dayLabel } from "@/lib/ui-helpers";
import { receiptsFeed } from "@/server/dashboard";
import { type ListPageProps, loadListPage } from "@/server/dashboard-page";
import { NO_REQUEST_NOTE, receiptNeedsAttention } from "@brain/core";
import { ProjectNav } from "../project-nav";

export const dynamic = "force-dynamic";

// Receipts feed (docs/DESIGN.md screen 1): newest first, 50 per page, under day headings; the newest receipt opens
// expanded. Chips, search and keyboard shortcuts filter it in the browser.
type ReceiptRow = {
  view: { items: { status: string }[]; findings: unknown[]; findingsOmitted: number };
};
const hasMissed = (r: ReceiptRow) => r.view.items.some((i) => i.status === "missed");
const hasFindings = (r: ReceiptRow) => r.view.findings.length + r.view.findingsOmitted > 0;

const GROUPS = [
  { key: "you", title: "Needs you", text: "Something was missed or needs a look. Start here." },
  {
    key: "fixing",
    title: "Agent is fixing",
    text: "Needed a look, and your agent has already made a newer receipt for the same request.",
  },
  { key: "good", title: "All good", text: "Everything you asked for checks out." },
] as const;

export default async function ReceiptsPage(
  props: ListPageProps & { searchParams: Promise<{ filter?: string | string[] }> },
) {
  const feed = await loadListPage(props, receiptsFeed);
  // FEAT-032: the overview's cards open this list already filtered (?filter=attention|good|missed|findings).
  const asked = (await props.searchParams).filter;
  const wanted = Array.isArray(asked) ? asked[0] : asked;
  const initialFilter = FILTERS.find((f) => f === wanted) ?? "all";
  const base = `/projects/${feed.project.id}`;
  const now = new Date();
  // FEAT-033: who has to act. A receipt that needs a look is "Agent is fixing" once a newer receipt answers the same
  // request (the agent already went back to it); otherwise it needs you.
  const redone = new Set<string>();
  const seen = new Set<string>();
  for (const r of feed.rows) {
    if (r.requestId && seen.has(r.requestId)) redone.add(r.id);
    if (r.requestId) seen.add(r.requestId);
  }
  const groupOf = (r: (typeof feed.rows)[number]) =>
    !receiptNeedsAttention(r.view) ? "good" : redone.has(r.id) ? "fixing" : "you";
  const openId = GROUPS.map((g) => feed.rows.find((r) => groupOf(r) === g.key)).find(Boolean)?.id;
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
            missed={feed.rows.filter(hasMissed).length}
            findings={feed.rows.filter(hasFindings).length}
            initial={initialFilter}
          >
            {GROUPS.map((g) => {
              const rows = feed.rows.filter((r) => groupOf(r) === g.key);
              if (rows.length === 0) return null;
              let lastDay = "";
              return (
                <section
                  key={g.key}
                  className="stack receipt-group"
                  data-group={g.key}
                  aria-labelledby={`group-${g.key}`}
                >
                  <h2 id={`group-${g.key}`} className="subhead m0">
                    {g.title} <span className="muted">({rows.length})</span>
                  </h2>
                  <p className="muted m0">{g.text}</p>
                  <ol className="stack plain-list">
                    {rows.flatMap((r) => {
                      const day = dayLabel(r.createdAt, now);
                      const heading =
                        day !== lastDay ? (
                          <li key={`day-${g.key}-${day}`} className="day-heading">
                            <h2 className="section-title">{day}</h2>
                          </li>
                        ) : null;
                      lastDay = day;
                      return [
                        heading,
                        <li
                          key={r.id}
                          data-attention={receiptNeedsAttention(r.view)}
                          data-missed={hasMissed(r)}
                          data-findings={hasFindings(r)}
                          data-search={(r.view.noRequest
                            ? NO_REQUEST_NOTE
                            : (r.asked ?? "")
                          ).toLowerCase()}
                        >
                          <ReceiptCard
                            receipt={r}
                            expanded={feed.page === 1 && r.id === openId}
                            share={
                              <ShareReceipt
                                projectId={r.projectId}
                                receiptId={r.id}
                                links={r.shareLinks}
                              />
                            }
                          />
                        </li>,
                      ];
                    })}
                  </ol>
                </section>
              );
            })}
          </ReceiptsFilter>
          <Pagination page={feed.page} pages={feed.pages} basePath={`${base}/receipts`} />
        </>
      )}
    </main>
  );
}
