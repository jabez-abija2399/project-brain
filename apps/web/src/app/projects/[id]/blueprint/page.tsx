import { EmptyState } from "@/components/ui/empty-state";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { VIEW_COOKIE, blueprintPage, viewMode } from "@/server/blueprint-page";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { cookies } from "next/headers";
import Link from "next/link";
import { ProjectNav } from "../project-nav";
import { BlueprintAction, ViewChoice } from "./blueprint-actions";
import { BlueprintEmpty } from "./not-ready";

export const dynamic = "force-dynamic";

const PROOF: Record<string, { status: Status; label: string }> = {
  proven: { status: "done", label: "Proven by a test" },
  done_not_proven: { status: "done_untested", label: "Done, not proven" },
  not_proven: { status: "open", label: "Not proven yet" },
  contradicted: { status: "missed", label: "Contradicted" },
};
const KIND: Record<string, string> = {
  behaviour: "Does",
  must_never: "Must never",
  security: "Security",
};

// Roadmap Phase 3c: the Blueprint tab. What the app must do and must never do, per feature, and how sure we are of
// each rule. Agents only propose; every change here is the owner's.
export default async function BlueprintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const query = (await searchParams)?.view;
  const user = await pageUser();
  const view = await orNotFound(() => blueprintPage(getDb(), user, id));
  const base = `/projects/${view.project.id}`;
  const nav = (
    <ProjectNav projectId={view.project.id} current="blueprint" name={view.project.name} />
  );
  if (!view.ready) {
    return (
      <BlueprintEmpty
        nav={nav}
        text="Codeceipt is getting the Blueprint ready for this project. Your features, receipts and plan work as before."
        action={{ label: "See the features", href: `${base}/features` }}
      />
    );
  }
  const mode = viewMode((await cookies()).get(VIEW_COOKIE)?.value, query);
  return (
    <main className="page stack stack-lg">
      <div>{nav}</div>
      <div className="row wrap">
        <span className="muted">Version {view.version}</span>
        <Link href={`${base}/blueprint/discover`}>Discover and safety check</Link>
        <Link href={`${base}/blueprint/history`}>History</Link>
        {mode ? <ViewChoice current={mode} /> : null}
      </div>
      {!mode ? <ViewChoice current={null} /> : null}
      {view.proposals.length > 0 ? (
        <section className="card stack" aria-labelledby="proposals-title">
          <h2 className="section-title m0" id="proposals-title">
            Waiting for you: {view.proposals.length} suggested by your agent
          </h2>
          <ul className="plain-list stack">
            {view.proposals.map((p) => (
              <li key={`${p.kind}-${p.id}`} className="stack">
                <span className="wrap">
                  {p.feature ? <strong>{p.feature}: </strong> : null}
                  {p.change ? "Change to: " : ""}
                  {p.text}
                </span>
                {p.current ? <span className="muted wrap">Now: {p.current}</span> : null}
                <span className="row">
                  <BlueprintAction
                    projectId={view.project.id}
                    path="decide"
                    body={{ kind: p.kind, id: p.id, accept: true, baseVersion: view.version }}
                    label="Accept"
                    ariaLabel={`Accept: ${p.text}`}
                    done="Accepted."
                    confirm={
                      p.text === "Retire this rule"
                        ? "Retire this rule? It stops guiding your agents. You can restore it from History."
                        : undefined
                    }
                  />
                  <BlueprintAction
                    projectId={view.project.id}
                    path="decide"
                    body={{ kind: p.kind, id: p.id, accept: false, baseVersion: view.version }}
                    label="Dismiss"
                    ariaLabel={`Dismiss: ${p.text}`}
                    done="Dismissed."
                    variant="ghost"
                  />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!mode ? null : view.features.length === 0 ? (
        <EmptyState
          title="No features yet"
          text="Index your project or approve a plan, then confirm each feature in Discover."
          action={{ label: "Open Discover", href: `${base}/blueprint/discover` }}
        />
      ) : (
        <section className="stack" aria-label="Features">
          {view.features.map((f) => (
            <article key={f.id} className="card stack">
              <h2 className="section-title m0">{f.name}</h2>
              {f.purpose ? <p className="m0 wrap">{f.purpose}</p> : null}
              <span className="row wrap">
                <span>
                  {f.rules} {f.rules === 1 ? "rule" : "rules"}: {f.proven} proven
                  {f.doneNotProven ? `, ${f.doneNotProven} done but not proven` : ""}
                </span>
                {f.contradicted ? (
                  <StatusBadge status="missed" label={`${f.contradicted} contradicted`} />
                ) : null}
                {f.noMustNever ? (
                  <StatusBadge status="warning" label="No must-never rule yet" />
                ) : null}
              </span>
              {mode === "detailed" ? (
                <div className="stack">
                  {f.dependsOn.length ? (
                    <p className="muted m0">Built after: {f.dependsOn.join(", ")}</p>
                  ) : null}
                  {f.areas.length ? (
                    <p className="muted m0 wrap">Files: {f.areas.join(", ")}</p>
                  ) : null}
                  <ul className="plain-list stack">
                    {f.criteria.map((c) => (
                      <li key={c.id} className="stack">
                        <span className="row wrap">
                          <StatusBadge
                            status={PROOF[c.proof]?.status ?? "open"}
                            label={PROOF[c.proof]?.label}
                          />
                          <span className="muted">{KIND[c.kind] ?? c.kind}</span>
                          <span className="wrap">{c.ears ?? c.text}</span>
                        </span>
                        {c.flags.map((x) => (
                          <span key={x.message} className="muted wrap list-indent">
                            {x.message}
                            {x.rewrite ? ` Try: ${x.rewrite}` : ""}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}
      {mode === "detailed" && view.boundaries.length > 0 ? (
        <section className="card stack" aria-labelledby="boundaries-title">
          <h2 className="section-title m0" id="boundaries-title">
            Boundaries
          </h2>
          <ul className="plain-list">
            {view.boundaries.map((b) => (
              <li key={b.id} className="wrap">
                {b.kind.replace(/_/g, " ")}: {b.pattern}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
