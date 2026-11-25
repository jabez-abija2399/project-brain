import { EmptyState } from "@/components/ui/empty-state";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { planView } from "@/server/plan";
import { ProjectNav } from "../project-nav";
import { PlanDraft } from "./plan-sections";

export const dynamic = "force-dynamic";

// FEAT-019: the agent's draft plan waits here. Nothing in it is active until the owner approves this exact draft.
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  const view = await orNotFound(() => planView(getDb(), user, id));
  const base = `/projects/${view.project.id}`;
  const draft = view.draft;
  return (
    <main className="page stack stack-lg">
      <div>
        <ProjectNav projectId={view.project.id} current="plan" name={view.project.name} />
      </div>
      {!draft ? (
        view.approvedAt ? (
          <EmptyState
            title="Plan approved"
            text={
              view.nextFeature
                ? `Agents build in order. Next feature: ${view.nextFeature}.`
                : "Every planned feature is done."
            }
            action={{ label: "See the features", href: `${base}/features` }}
          />
        ) : (
          <EmptyState
            title="No plan yet"
            text="Your project plan appears here for your approval: ask your agent to plan the project from your idea (plan_project)."
            action={{ label: "Get started", href: "/start" }}
          />
        )
      ) : (
        <PlanDraft projectId={view.project.id} draft={draft} />
      )}
    </main>
  );
}
