import { ChecklistItem } from "@/components/checklist-item";
import { EmptyState } from "@/components/ui/empty-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { When } from "@/components/ui/when";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { featureDetail } from "@/server/feature-detail";
import Link from "next/link";
import { ProjectNav } from "../../project-nav";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { status: Status; label: string }> = {
  todo: { status: "open", label: "To do" },
  in_progress: { status: "partial", label: "In progress" },
  done: { status: "done", label: "Done" },
};

// FEAT-034: one feature: how far it is, what is still open, and the receipts that touched it.
export default async function FeaturePage({
  params,
}: {
  params: Promise<{ id: string; featureId: string }>;
}) {
  const { id, featureId } = await params;
  const user = await pageUser();
  const d = await orNotFound(() => featureDetail(getDb(), user, id, featureId));
  const base = `/projects/${d.project.id}`;
  const s = STATUS[d.feature.status] ?? { status: "neutral" as const, label: "Unknown" };
  return (
    <main className="page stack stack-lg">
      <div>
        <ProjectNav projectId={d.project.id} current="features" name={d.project.name} />
      </div>
      <section className="card stack" aria-labelledby="feature-title">
        <p className="m0">
          <Link href={`${base}/features`}>All features</Link>
        </p>
        <div className="row between">
          <h2 id="feature-title" className="section-title m0 wrap">
            {d.feature.name}
          </h2>
          <StatusBadge status={s.status} label={s.label} />
        </div>
        {d.total > 0 ? (
          <span className="progress-cell">
            <ProgressBar
              done={d.done}
              total={d.total}
              label={`${d.feature.name}: ${d.done} of ${d.total} done`}
            />
            <span className="muted">
              {d.done} of {d.total} done
            </span>
          </span>
        ) : (
          <p className="muted m0">
            Nothing planned yet. Ask your agent: &ldquo;plan the {d.feature.name} feature&rdquo;.
          </p>
        )}
      </section>
      <section className="card stack" aria-labelledby="items-title">
        <h3 id="items-title" className="section-title m0">
          What you asked for
        </h3>
        {d.items.length === 0 ? (
          <p className="muted m0">No checklist items yet.</p>
        ) : (
          <ul className="stack plain-list">
            {d.items.map((i) => (
              <ChecklistItem
                key={i.id}
                text={i.text}
                status={i.status}
                evidence={[]}
                action={i.status === "done" ? undefined : { projectId: d.project.id, itemId: i.id }}
              />
            ))}
          </ul>
        )}
      </section>
      <section className="card stack" aria-labelledby="receipts-title">
        <h3 id="receipts-title" className="section-title m0">
          Receipts for this feature
        </h3>
        {d.receipts.length === 0 ? (
          <EmptyState
            title="No receipts yet"
            text="When your agent works on this feature and ends the session, its receipt shows here."
            action={{ label: "See all receipts", href: `${base}/receipts` }}
          />
        ) : (
          <ul className="attention-list">
            {d.receipts.map((r) => (
              <li key={r.id}>
                <Link href={`${base}/receipts#receipt-${r.id}`} className="attention-item">
                  <span className="attention-asked wrap">{r.asked}</span>
                  <StatusBadge
                    status={r.attention ? "missed" : "done"}
                    label={r.attention ? "Needs a look" : "All good"}
                  />
                  <When className="muted" iso={r.createdAt} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
