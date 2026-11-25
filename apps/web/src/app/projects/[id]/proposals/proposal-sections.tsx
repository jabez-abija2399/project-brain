import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { When } from "@/components/ui/when";
import type { pendingProposals } from "@/server/dashboard";
import type { directiveProposals } from "@/server/session-tools";
import { DirectiveActions } from "./directive-actions";
import { ProposalActions } from "./proposal-actions";

// FEAT-030: the Proposals page in two parts, shown on the To decide tab too.
type List = Awaited<ReturnType<typeof pendingProposals>>;
type Rules = Awaited<ReturnType<typeof directiveProposals>>;

export function RuleProposals({
  list,
  rules,
}: { list: { project: { id: string } }; rules: Rules }) {
  return (
    <>
      {rules.length > 0 ? (
        <section className="stack" aria-labelledby="rule-proposals">
          <h2 className="section-title m0" id="rule-proposals">
            Rules your agent proposed
          </h2>
          <p className="muted m0">
            An agent wrote these. A rule you confirm is given to every agent session from now on, so
            read it as you would a stranger's instruction: confirm only a rule you would have
            written yourself. Proposals older than 30 days are no longer shown.
          </p>
          <ul className="stack plain-list">
            {rules.map((r) => (
              <li key={r.id} className="card stack">
                <span className="muted">
                  Written by an agent, <When iso={r.createdAt} />
                </span>
                <blockquote className="wrap m0" id={`rule-${r.id}`}>
                  {r.text}
                </blockquote>
                <DirectiveActions
                  projectId={list.project.id}
                  directiveId={r.id}
                  describedBy={`rule-${r.id}`}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export function ChecklistProposals({
  list,
  base,
  pageBase,
  emptyAction = true,
}: {
  list: List;
  base: string;
  pageBase: string;
  emptyAction?: boolean;
}) {
  if (list.total === 0 && !emptyAction) return null;
  return (
    <>
      {list.total === 0 ? (
        <EmptyState
          title="No proposals waiting"
          text="Checklist changes an agent proposes appear here for your decision, when an agent asks to reword or drop an item."
          action={{ label: "See the receipts", href: `${base}/receipts` }}
        />
      ) : (
        <>
          <ul className="stack plain-list">
            {list.rows.map((p) => (
              <li key={p.id} className="card stack">
                <span className="row">
                  <StatusBadge
                    status="warning"
                    label={p.shownText === null ? "Drop item" : "Reword item"}
                  />
                  <span className="muted">
                    proposed <When iso={p.proposedAt} />
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
          <Pagination page={list.page} pages={list.pages} basePath={pageBase} />
        </>
      )}
    </>
  );
}
