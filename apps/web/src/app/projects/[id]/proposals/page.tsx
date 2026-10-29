import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { pendingProposals } from "@/server/dashboard";
import { type ListPageProps, loadListPage } from "@/server/dashboard-page";
import { ProjectNav } from "../project-nav";
import { ProposalActions } from "./proposal-actions";

export const dynamic = "force-dynamic";

// Checklist proposals from agents (FEAT-012): nothing changes until the owner confirms the proposal shown here.
export default async function ProposalsPage(props: ListPageProps) {
  const list = await loadListPage(props, pendingProposals);
  const base = `/projects/${list.project.id}`;
  return (
    <main className="page">
      <ProjectNav projectId={list.project.id} current="proposals" name={list.project.name} />
      {list.total === 0 ? (
        <EmptyState
          title="No proposals waiting"
          text="When an agent proposes to reword or drop a checklist item, it waits here for you."
          action={{ label: "See the receipts", href: `${base}/receipts` }}
        />
      ) : (
        <>
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {list.rows.map((p) => (
              <li key={p.id} className="card stack">
                <span className="row">
                  <StatusBadge
                    status="warning"
                    label={p.shownText === null ? "Drop item" : "Reword item"}
                  />
                  <span className="muted">
                    proposed{" "}
                    <time dateTime={p.proposedAt}>
                      {p.proposedAt.slice(0, 16).replace("T", " ")} UTC
                    </time>
                  </span>
                </span>
                <span className="wrap">
                  <span className="muted">Now: </span>
                  {p.text}
                </span>
                {p.shownText !== null && (
                  <span className="wrap">
                    <span className="muted">Proposed: </span>
                    {p.shownText}
                  </span>
                )}
                <ProposalActions
                  projectId={list.project.id}
                  itemId={p.id}
                  shown={{ proposedAt: p.proposedAt, change: p.change }}
                />
              </li>
            ))}
          </ul>
          <Pagination page={list.page} pages={list.pages} basePath={`${base}/proposals`} />
        </>
      )}
    </main>
  );
}
