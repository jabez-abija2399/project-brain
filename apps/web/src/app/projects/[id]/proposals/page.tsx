import { pendingProposals } from "@/server/dashboard";
import { type ListPageProps, loadListPage, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { directiveProposals } from "@/server/session-tools";
import { ProjectNav } from "../project-nav";
import { ChecklistProposals, RuleProposals } from "./proposal-sections";

export const dynamic = "force-dynamic";

// Checklist proposals from agents (FEAT-012): nothing changes until the owner confirms the proposal shown here.
export default async function ProposalsPage(props: ListPageProps) {
  const list = await loadListPage(props, pendingProposals);
  const base = `/projects/${list.project.id}`;
  const rules = await directiveProposals(getDb(), await pageUser(), list.project.id);
  return (
    <main className="page stack stack-lg">
      <ProjectNav projectId={list.project.id} current="proposals" name={list.project.name} />
      <RuleProposals list={list} rules={rules} />
      <ChecklistProposals list={list} base={base} pageBase={`${base}/proposals`} />
    </main>
  );
}
