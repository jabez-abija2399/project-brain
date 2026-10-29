import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { planView } from "@/server/plan";
import { ProjectNav } from "../project-nav";
import { PlanActions } from "./plan-actions";

export const dynamic = "force-dynamic";

// FEAT-019: the agent's draft plan waits here. Nothing in it is active until the owner approves this exact draft.
export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  const view = await orNotFound(() => planView(getDb(), user, id));
  const base = `/projects/${view.project.id}`;
  const draft = view.draft;
  return (
    <main className="page stack">
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
            text="Ask your agent to plan the project with your idea (plan_project). Its draft waits here for your approval."
            action={{ label: "Connect an agent", href: `${base}/connect` }}
          />
        )
      ) : (
        <section className="stack" aria-labelledby="draft-title">
          <div className="card stack">
            <span className="row">
              <StatusBadge status="warning" label="Waiting for your approval" />
              <span className="muted">
                drafted{" "}
                <time dateTime={draft.createdAt}>
                  {draft.createdAt.slice(0, 16).replace("T", " ")} UTC
                </time>
              </span>
            </span>
            <h2 id="draft-title" style={{ fontSize: 16, margin: 0 }}>
              Draft plan: {draft.features.length} features
            </h2>
            {draft.restated.map((line, n) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: model-written lines may repeat; the order is fixed
              <p key={n} className="wrap" style={{ margin: 0 }}>
                {line}
              </p>
            ))}
            <p className="muted" style={{ margin: 0 }}>
              Approving adds the new features in this order with their checklists. Agents can then
              build them but cannot change the plan.
            </p>
          </div>
          <ol className="stack" style={{ padding: 0, margin: 0, listStyle: "none" }}>
            {draft.features.map((f, n) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: names may look alike; the build order is the identity
              <li key={n} className="card stack">
                <span className="row">
                  <strong className="wrap">
                    {n + 1}. {f.name}
                  </strong>
                  {f.existing ? (
                    <StatusBadge status="done" label="Already built" />
                  ) : (
                    <StatusBadge status="open" label="New" />
                  )}
                </span>
                {f.dependsOn.length > 0 && (
                  <span className="muted wrap">Needs: {f.dependsOn.join(", ")}</span>
                )}
                {f.items.length > 0 && (
                  <ul className="stack" style={{ margin: 0, paddingLeft: 20 }}>
                    {f.items.map((i, k) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: item texts may repeat; the order is fixed
                      <li key={k} className="wrap">
                        <span className="muted">[{i.kind}] </span>
                        {i.text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          <PlanActions projectId={view.project.id} draftId={draft.id} draftHash={draft.hash} />
        </section>
      )}
    </main>
  );
}
