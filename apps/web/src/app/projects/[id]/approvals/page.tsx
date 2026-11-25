import { EmptyState } from "@/components/ui/empty-state";
import { approvalsPage } from "@/server/approvals-page";
import { VIEW_COOKIE, viewMode } from "@/server/blueprint-page";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { cookies } from "next/headers";
import { ViewChoice } from "../blueprint/blueprint-actions";
import { ProjectNav } from "../project-nav";
import { ApprovalPolicy, PendingRequests } from "./approval-sections";

export const dynamic = "force-dynamic";

// Roadmap Phase 6b: the Approvals tab. What agents may do on their own, what they must ask for, and what is waiting
// for the owner. Simple shows the presets; Detailed also shows the table of actions and the policy's rules.
export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const query = (await searchParams)?.view;
  const user = await pageUser();
  const view = await orNotFound(() => approvalsPage(getDb(), user, id));
  const nav = (
    <ProjectNav projectId={view.project.id} current="approvals" name={view.project.name} />
  );
  const o = view.overview;
  if (!o.ready) {
    return (
      <main className="page stack stack-lg">
        <div>{nav}</div>
        <EmptyState
          title="Approvals are being set up"
          text="Codeceipt is getting approvals ready for this server. Until then your agents ask nothing and everything else works as before."
          action={{ label: "See the receipts", href: `/projects/${view.project.id}/receipts` }}
        />
      </main>
    );
  }
  const mode = viewMode((await cookies()).get(VIEW_COOKIE)?.value, query) ?? "simple";
  const pid = view.project.id;
  return (
    <main className="page stack stack-lg">
      <div>{nav}</div>
      <div className="row wrap">
        <ViewChoice current={mode} />
      </div>

      <PendingRequests pid={pid} o={o} />
      <ApprovalPolicy pid={pid} o={o} table={view.table} mode={mode} />
    </main>
  );
}
