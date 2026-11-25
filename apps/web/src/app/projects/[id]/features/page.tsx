import { FeaturesFilter } from "@/components/features-filter";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { ProgressBar } from "@/components/ui/progress-bar";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { When } from "@/components/ui/when";
import { boardSort, featureBoard } from "@/server/dashboard";
import { type ListPageProps, loadListPage, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { planView } from "@/server/plan";
import Link from "next/link";
import { PlanDraft } from "../plan/plan-sections";
import { ProjectNav } from "../project-nav";

export const dynamic = "force-dynamic";

const FEATURE_STATUS: Record<string, { status: Status; label: string }> = {
  todo: { status: "open", label: "To do" },
  in_progress: { status: "partial", label: "In progress" },
  done: { status: "done", label: "Done" },
};
const SORTS = [
  ["name", "Name"],
  ["open", "Most open"],
  ["recent", "Recent receipt"],
] as const;

const DAY_MS = 86_400_000;
// "today", "yesterday", "3 days ago" next to the date (the date stays visible and in the time element).
function ago(iso: string, now: Date): string {
  const days = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      Date.UTC(
        new Date(iso).getUTCFullYear(),
        new Date(iso).getUTCMonth(),
        new Date(iso).getUTCDate(),
      )) /
      DAY_MS,
  );
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

// Feature board (docs/DESIGN.md screen 2): a summary over the whole project, then each feature with its status, the
// next open item, progress, files, open items and the last receipt. Sorting is on the server (?sort=, kept across
// pages); search and chips filter the rows in place.
export default async function FeatureBoardPage(props: ListPageProps) {
  const sort = boardSort((await props.searchParams).sort);
  const board = await loadListPage(props, (db, user, id, page) =>
    featureBoard(db, user, id, page, sort),
  );
  const base = `/projects/${board.project.id}`;
  const now = new Date();
  const c = board.counts;
  // FEAT-030: the Plan tab is gone; a draft plan waiting for approval shows at the top of Features.
  const plan = await planView(getDb(), await pageUser(), board.project.id);
  return (
    <main className="page stack gap-20">
      <div>
        <ProjectNav projectId={board.project.id} current="features" name={board.project.name} />
      </div>
      {plan.draft ? (
        <section className="stack" id="plan" aria-label="Plan waiting for your approval">
          {/* FEAT-034: a banner first, then the draft to review. */}
          <p className="plan-banner m0" data-testid="plan-banner">
            Your agent drafted a plan with {plan.draft.features.length} feature
            {plan.draft.features.length === 1 ? "" : "s"}. Review it below and approve it, or tell
            your agent what to change.
          </p>
          <PlanDraft projectId={board.project.id} draft={plan.draft} />
        </section>
      ) : null}
      {board.total === 0 ? (
        <EmptyState
          title="No features yet"
          text="Features grouped from your code appear here after the first index: run npx codeceipt in your project."
          action={{ label: "Get started", href: "/start" }}
        />
      ) : (
        <>
          <nav className="sort row" aria-label="Sort features">
            <span className="muted">Sort:</span>
            {SORTS.map(([key, label]) => (
              <Link
                key={key}
                href={`${base}/features${key === "name" ? "" : `?sort=${key}`}`}
                className="chip"
                aria-current={sort === key ? "true" : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <FeaturesFilter counts={c}>
            <DataTable
              caption={`${board.total} features`}
              rows={board.rows}
              rowKey={(r) => r.id}
              columns={[
                {
                  key: "name",
                  header: "Feature",
                  cell: (r) => (
                    <span
                      className="feature-cell"
                      data-feature={r.name.toLowerCase()}
                      data-status={r.status}
                      data-open={r.openItems}
                    >
                      <Link href={`${base}/features/${r.id}`}>
                        <strong>{r.name}</strong>
                      </Link>
                      {r.nextItem && <span className="muted wrap">Next: {r.nextItem}</span>}
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  cell: (r) => {
                    const s = FEATURE_STATUS[r.status] ?? {
                      status: "neutral" as const,
                      label: r.status,
                    };
                    return <StatusBadge status={s.status} label={s.label} />;
                  },
                },
                {
                  key: "progress",
                  header: "Progress",
                  cell: (r) =>
                    r.totalItems > 0 ? (
                      <span className="progress-cell">
                        <ProgressBar
                          done={r.doneItems}
                          total={r.totalItems}
                          label={`${r.name}: ${r.doneItems} of ${r.totalItems} done`}
                        />
                        <span className="muted">
                          {r.doneItems} of {r.totalItems} done
                        </span>
                      </span>
                    ) : (
                      <span className="muted">
                        Nothing planned yet. Ask your agent: &ldquo;plan the {r.name} feature&rdquo;
                      </span>
                    ),
                },
                { key: "files", header: "Files", cell: (r) => r.files },
                {
                  key: "open",
                  header: "Open items",
                  cell: (r) =>
                    r.openItems > 0 ? (
                      <StatusBadge status="warning" label={`${r.openItems} open`} />
                    ) : (
                      <StatusBadge status="done" label="None open" />
                    ),
                },
                {
                  key: "receipt",
                  header: "Last receipt",
                  cell: (r) =>
                    r.lastReceiptAt ? (
                      <span className="receipt-when">
                        <When iso={r.lastReceiptAt} format="day" />
                        <span className="muted">{ago(r.lastReceiptAt, now)}</span>
                      </span>
                    ) : (
                      <span className="muted">None yet</span>
                    ),
                },
              ]}
            />
          </FeaturesFilter>
          <Pagination
            page={board.page}
            pages={board.pages}
            basePath={`${base}/features`}
            query={sort === "name" ? undefined : `sort=${sort}`}
          />
        </>
      )}
    </main>
  );
}
