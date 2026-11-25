import { CopyButton } from "@/components/ui/copy-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { discoverPage } from "@/server/blueprint-page";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { ProjectNav } from "../../project-nav";
import { BlueprintAction } from "../blueprint-actions";
import { BlueprintEmpty } from "../not-ready";

export const dynamic = "force-dynamic";

// FEAT-036: each risk said the way a person would say it (the check's own wording stays under Technical details).
const HEADLINE: Record<string, string> = {
  secret: "A secret key is in your code, where others could find it",
  rls_disabled: "Anyone on the internet can read and change this table",
  policy_allows_everyone_to_write: "Anyone on the internet can write to this table",
  rls_cannot_be_confirmed: "We can't confirm that this table is protected",
  test_integrity: "Tests were removed or weakened",
  no_must_never: "Some features have no rule for what must never happen",
};
const capitalize = (t: string) => `${t.charAt(0).toUpperCase()}${t.slice(1)}`;

// Roadmap Phase 3c: Discover (the app as built, confirmed one feature at a time) and the safety check (the most
// important existing risks, each with a prompt to hand to your agent).
export default async function DiscoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  const view = await orNotFound(() => discoverPage(getDb(), user, id));
  const base = `/projects/${view.project.id}`;
  const nav = (
    <ProjectNav
      projectId={view.project.id}
      current="blueprint"
      name={view.project.name}
      sub={{
        label: "Safety check",
        purpose:
          "Problems that could hurt your users, most urgent first, then your app's parts to confirm.",
      }}
    />
  );
  if (!view.ready) {
    return (
      <BlueprintEmpty
        nav={nav}
        text="Discover appears here once the Blueprint is ready for this project."
        action={{ label: "Back to the Blueprint", href: `${base}/blueprint` }}
      />
    );
  }
  const next = view.discover.features.find((f) => f.featureId === view.discover.next);
  const confirmed = view.discover.features.filter((f) => f.confirmed).length;
  return (
    <main className="page stack stack-lg">
      <div>{nav}</div>
      <section className="card stack" aria-labelledby="safety-title">
        <h2 className="section-title m0" id="safety-title">
          Safety check
        </h2>
        {view.safety.risks.length === 0 ? (
          <p className="muted m0">
            No risks found in what Codeceipt can see ({view.safety.tablesChecked} tables, the last{" "}
            {view.safety.receiptsChecked} of at most {view.safety.receiptsLimit} receipts).
          </p>
        ) : (
          <ol className="plain-list stack">
            {view.safety.risks.map((r, n) => (
              <li key={`${n}-${r.kind}`} className="stack">
                <span className="row wrap">
                  <StatusBadge
                    status={r.severity === "high" ? "missed" : "warning"}
                    label={r.severity === "high" ? "Fix first" : "Check"}
                  />
                  <strong>{HEADLINE[r.kind] ?? capitalize(r.title)}</strong>
                </span>
                {/* FEAT-036: the people version first; paths, tables and SQL sit under Technical details. */}
                <details className="tech-details">
                  <summary>Technical details</summary>
                  <p className="muted wrap m0">{r.where}</p>
                  <p className="wrap m0">{r.why}</p>
                </details>
                <CopyButton text={r.fixPrompt} label="Fix with my agent" />
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="card stack" aria-labelledby="discover-title">
        <h2 className="section-title m0" id="discover-title">
          Discover: {confirmed} of {view.discover.features.length} features confirmed
        </h2>
        <progress
          className="progress"
          value={confirmed}
          max={Math.max(1, view.discover.features.length)}
          aria-label={`${confirmed} of ${view.discover.features.length} features confirmed`}
        />
        {view.discover.truncated ? (
          <p className="muted m0">This project is large, so this list is incomplete.</p>
        ) : null}
        {next ? (
          <div className="stack">
            <h3 className="m0">
              Step {confirmed + 1} of {view.discover.features.length}: {next.name}. Does this look
              right?
            </h3>
            <p className="muted m0">
              {next.files} files, {next.tests} related test files
              {next.routes.length ? `; pages and routes: ${next.routes.join(", ")}` : ""}
              {next.components.length ? `; components: ${next.components.join(", ")}` : ""}.
            </p>
            {next.suggestions.length > 0 ? (
              // FEAT-036: confirming keeps every suggested rule at once; each one can also be kept alone below.
              <BlueprintAction
                projectId={view.project.id}
                path=""
                body={{
                  baseVersion: view.version,
                  ops: next.suggestions.map((s) => ({
                    op: "addCriterion",
                    featureId: next.featureId,
                    text: s.text,
                    kind: s.kind,
                  })),
                }}
                label="Confirm this feature"
                variant="primary"
                done="Confirmed. On to the next one."
              />
            ) : null}
            {next.suggestions.length === 0 ? (
              <p className="m0">
                Nothing to suggest. Add the rules this feature must follow on the Blueprint tab.
              </p>
            ) : (
              <ul className="plain-list stack">
                {next.suggestions.map((s, n) => (
                  <li key={`${n}-${s.kind}`} className="stack">
                    <span className="wrap">{s.text}</span>
                    <span className="muted wrap">{s.why}</span>
                    <BlueprintAction
                      projectId={view.project.id}
                      path=""
                      body={{
                        baseVersion: view.version,
                        ops: [
                          {
                            op: "addCriterion",
                            featureId: next.featureId,
                            text: s.text,
                            kind: s.kind,
                          },
                        ],
                      }}
                      label="Add this rule"
                      done="Added."
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="m0" data-testid="all-mapped">
            Your whole app is mapped: every feature is confirmed.
          </p>
        )}
      </section>
    </main>
  );
}
