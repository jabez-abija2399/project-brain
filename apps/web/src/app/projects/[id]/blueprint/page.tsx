import { CopyButton } from "@/components/ui/copy-button";
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

type Feature = {
  name: string;
  rules: number;
  proven: number;
};

// FEAT-036: one plain sentence about a feature's promises.
function healthSentence(f: Feature): string {
  if (f.rules === 0) return `${f.name} has no promises yet. Add what it must never do.`;
  const promises = `${f.rules} promise${f.rules === 1 ? "" : "s"}`;
  if (f.proven === f.rules) return `${f.name}: all ${promises} are checked by tests.`;
  if (f.proven === 0) return `${f.name}: ${promises}, none checked by a test yet.`;
  return `${f.name}: ${promises}, ${f.proven} checked by a test.`;
}

type Rule = {
  id: string;
  plain: string;
  formal: string;
  proof: string;
  kind: string;
  flags: { message: string; rewrite?: string | null }[];
};

// A rule in plain words; Full detail adds the formal wording and the wording hints.
function RuleLine({ c, detailed }: { c: Rule; detailed: boolean }) {
  return (
    <li className="stack gap-4">
      <span className="row wrap">
        {detailed ? (
          <StatusBadge status={PROOF[c.proof]?.status ?? "open"} label={PROOF[c.proof]?.label} />
        ) : null}
        <span className="wrap">{c.plain}</span>
      </span>
      {detailed ? (
        <>
          <span className="muted wrap list-indent">
            {KIND[c.kind] ?? c.kind}, formal wording: {c.formal}
          </span>
          {c.flags.map((x) => (
            <span key={x.message} className="muted wrap list-indent">
              {x.message}
            </span>
          ))}
        </>
      ) : null}
    </li>
  );
}

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
  // FEAT-036: one summary line, then each feature with a health sentence and one action.
  const rules = view.features.reduce((n, f) => n + f.rules, 0);
  const proven = view.features.reduce((n, f) => n + f.proven, 0);
  const parts = view.features.length;
  const waiting = view.proposals.length;
  return (
    <main className="page stack stack-lg">
      <div>{nav}</div>
      <section className="overview-hero stack" aria-labelledby="blueprint-summary">
        <h2 id="blueprint-summary" className="overview-headline">
          {`Your app has ${parts} part${parts === 1 ? "" : "s"} and ${rules} promise${rules === 1 ? "" : "s"}.`}
        </h2>
        <p className="muted m0">
          {`${proven} ${proven === 1 ? "is" : "are"} proven by tests.`}
          {waiting > 0
            ? ` ${waiting} suggestion${waiting === 1 ? " is" : "s are"} waiting for you.`
            : ""}
        </p>
        <p className="row wrap m0">
          {waiting > 0 ? (
            <a className="btn btn-primary" href="#proposals-title">
              Review {waiting === 1 ? "it" : "them"}
            </a>
          ) : null}
          <Link href={`${base}/blueprint/discover`}>Safety check and Discover</Link>
          <Link href={`${base}/blueprint/history`}>History</Link>
          <span className="muted">Version {view.version}</span>
        </p>
      </section>
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
      <div className="row wrap">
        <ViewChoice current={mode} />
      </div>
      {view.features.length === 0 && !mode ? null : view.features.length === 0 ? (
        <EmptyState
          title="No features yet"
          text="Index your project or approve a plan, then confirm each feature in Discover."
          action={{ label: "Open Discover", href: `${base}/blueprint/discover` }}
        />
      ) : (
        <section className="stack" aria-label="Features">
          {view.features.map((f) => {
            const does = f.criteria.filter((c) => c.kind === "behaviour");
            const never = f.criteria.filter((c) => c.kind !== "behaviour");
            return (
              <article key={f.id} className="card stack" data-feature={f.id}>
                <h2 className="section-title m0">{f.name}</h2>
                {f.purpose ? <p className="m0 wrap">{f.purpose}</p> : null}
                <p className="m0 wrap" data-testid="health">
                  {healthSentence(f)}
                </p>
                <span className="row wrap">
                  {f.contradicted ? (
                    <StatusBadge status="missed" label={`${f.contradicted} contradicted`} />
                  ) : null}
                  {f.rules > f.proven ? (
                    <CopyButton
                      label={
                        f.rules === 0 ? "Copy a prompt to add a rule" : "Copy a prompt for tests"
                      }
                      text={
                        f.rules === 0
                          ? `Add what the ${f.name} feature must never do to the Codeceipt Blueprint, as one rule.`
                          : `Write a test for each rule of the ${f.name} feature in the Codeceipt Blueprint that no test proves yet, and link it.`
                      }
                    />
                  ) : null}
                </span>
                {never.length > 0 ? (
                  <div className="stack gap-6">
                    <h3 className="subhead m0">It must never</h3>
                    <ul className="plain-list stack gap-6">
                      {never.map((c) => (
                        <RuleLine key={c.id} c={c} detailed={mode === "detailed"} />
                      ))}
                    </ul>
                  </div>
                ) : null}
                {does.length > 0 ? (
                  <div className="stack gap-6">
                    <h3 className="subhead m0">It does</h3>
                    <ul className="plain-list stack gap-6">
                      {does.map((c) => (
                        <RuleLine key={c.id} c={c} detailed={mode === "detailed"} />
                      ))}
                    </ul>
                  </div>
                ) : null}
                {mode === "detailed" ? (
                  <div className="stack">
                    {f.dependsOn.length ? (
                      <p className="muted m0">Needs first: {f.dependsOn.join(", ")}</p>
                    ) : null}
                    {f.areas.length ? (
                      <p className="muted m0 wrap">Files: {f.areas.join(", ")}</p>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
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
