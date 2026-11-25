import { StatusBadge } from "@/components/ui/status-badge";
import { When } from "@/components/ui/when";
import type { planView } from "@/server/plan";
import { PlanActions } from "./plan-actions";

// FEAT-030: the draft plan, shown on the Plan page and at the top of the Features tab while it waits.
type Draft = NonNullable<Awaited<ReturnType<typeof planView>>["draft"]>;

export function PlanDraft({ projectId, draft }: { projectId: string; draft: Draft }) {
  return (
    <section className="stack" aria-labelledby="draft-title">
      <div className="card stack">
        <span className="row">
          <StatusBadge status="warning" label="Waiting for your approval" />
          <span className="muted">
            drafted <When iso={draft.createdAt} />
          </span>
        </span>
        <h2 className="section-title" id="draft-title">
          Draft plan: {draft.features.length} features
        </h2>
        {draft.restated.map((line, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: model-written lines may repeat; the order is fixed
          <p key={n} className="wrap m0">
            {line}
          </p>
        ))}
        <p className="muted m0">
          Approving adds the new features in this order with their checklists. Agents can then build
          them but cannot change the plan.
        </p>
      </div>
      <ol className="stack plain-list">
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
              <ul className="stack m0 list-indent">
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
      <PlanActions projectId={projectId} draftId={draft.id} draftHash={draft.hash} />
    </section>
  );
}
