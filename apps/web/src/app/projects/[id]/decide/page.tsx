import { EmptyState } from "@/components/ui/empty-state";
import { approvalsPage } from "@/server/approvals-page";
import { pendingProposals } from "@/server/dashboard";
import { type ListPageProps, loadListPage, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { directiveProposals } from "@/server/session-tools";
import { PendingRequests } from "../approvals/approval-sections";
import { ProjectNav } from "../project-nav";
import { ChecklistProposals, RuleProposals } from "../proposals/proposal-sections";

export const dynamic = "force-dynamic";

// FEAT-030: To decide, one place for everything an agent waits on: approval requests, checklist proposals and rule
// proposals. Every decision goes through the owner's routes; nothing changes until the owner acts.
export default async function DecidePage(props: ListPageProps) {
  const list = await loadListPage(props, pendingProposals);
  const user = await pageUser();
  const db = getDb();
  const pid = list.project.id;
  const base = `/projects/${pid}`;
  const [rules, approvals] = await Promise.all([
    directiveProposals(db, user, pid),
    approvalsPage(db, user, pid),
  ]);
  const o = approvals.overview;
  const pending = o.ready ? o.pending.length : 0;
  const nothing = pending === 0 && rules.length === 0 && list.total === 0;
  return (
    <main className="page stack stack-lg">
      <ProjectNav projectId={pid} current="decide" name={list.project.name} />
      {nothing ? (
        <EmptyState
          title="Nothing to decide"
          text="When an agent asks for something your settings keep for you, or wants to change what it was asked to build, it shows here."
          action={{ label: "See the receipts", href: `${base}/receipts` }}
        />
      ) : (
        <>
          {/* FEAT-039: one heading, one count (the same as the tab's badge), then one list of identical cards. */}
          <header className="group-head">
            <h2 className="group-title m0">
              Waiting for you{" "}
              <span className="group-count">{pending + rules.length + list.total}</span>
            </h2>
            <p className="muted m0">
              Approve what you would have done yourself. Nothing changes until you decide.
            </p>
          </header>
          {o.ready && pending > 0 ? <PendingRequests pid={pid} o={o} bare /> : null}
          <RuleProposals list={list} rules={rules} />
          <ChecklistProposals
            list={list}
            base={base}
            pageBase={`${base}/decide`}
            emptyAction={false}
          />
        </>
      )}
    </main>
  );
}
