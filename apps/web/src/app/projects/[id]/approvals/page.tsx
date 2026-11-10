import { EmptyState } from "@/components/ui/empty-state";
import { CHOICE_LABELS, PRESET_TEXT, approvalsPage } from "@/server/approvals-page";
import { VIEW_COOKIE, viewMode } from "@/server/blueprint-page";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { cookies } from "next/headers";
import { ViewChoice } from "../blueprint/blueprint-actions";
import { ProjectNav } from "../project-nav";
import { ApprovalAction } from "./approval-actions";

export const dynamic = "force-dynamic";

const PRESETS = ["careful", "balanced", "fast"] as const;
const RISK_LABEL = { low: "Low", medium: "Medium", high: "High", locked: "Locked" } as const;

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
  const paused = o.policy.pausedUntil && new Date(o.policy.pausedUntil).getTime() > Date.now();
  const pid = view.project.id;
  const withPreset = (preset: (typeof PRESETS)[number]) => ({
    policy: { preset, rules: o.policy.rules, pausedUntil: o.policy.pausedUntil ?? null },
  });
  return (
    <main className="page stack stack-lg">
      <div>{nav}</div>
      <div className="row wrap">
        <ViewChoice current={mode} />
      </div>

      <section className="card stack" aria-labelledby="pending-title">
        <h2 className="section-title m0" id="pending-title">
          {o.pending.length > 0
            ? `Waiting for you: ${o.pending.length}`
            : "Nothing is waiting for you"}
        </h2>
        {o.pending.length === 0 ? (
          <p className="muted m0">
            When an agent asks for something your policy keeps for you, it shows here. Requests
            expire after 24 hours.
          </p>
        ) : (
          <ul className="plain-list stack">
            {o.pending.map((r) => (
              <li key={r.id} className="stack">
                <span className="wrap">
                  <strong>{r.action.replaceAll("_", " ")}</strong>
                  {r.feature ? ` in ${r.feature}` : ""}
                  {r.path ? ` (${r.path})` : ""}: {r.summary}
                </span>
                <span className="muted">
                  {RISK_LABEL[r.risk as keyof typeof RISK_LABEL] ?? r.risk} risk
                  {r.agent ? `, asked by ${r.agent}` : ""}, expires{" "}
                  {new Date(r.expiresAt).toUTCString()}
                </span>
                <span className="row wrap">
                  <ApprovalAction
                    projectId={pid}
                    path="decide"
                    body={{ requestId: r.id, decision: "approve" }}
                    label="Approve"
                    done="Approved."
                    variant="primary"
                    ariaLabel={`Approve: ${r.summary}`}
                  />
                  <ApprovalAction
                    projectId={pid}
                    path="decide"
                    body={{ requestId: r.id, decision: "reject" }}
                    label="Reject"
                    done="Rejected."
                    ariaLabel={`Reject: ${r.summary}`}
                  />
                  <ApprovalAction
                    projectId={pid}
                    path="decide"
                    body={{ requestId: r.id, decision: "approve", remember: true }}
                    label="Always approve this kind"
                    done="Approved, and remembered."
                    variant="ghost"
                  />
                  <ApprovalAction
                    projectId={pid}
                    path="decide"
                    body={{ requestId: r.id, decision: "reject", remember: true }}
                    label="Always reject this kind"
                    done="Rejected, and remembered."
                    variant="ghost"
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack" aria-labelledby="preset-title">
        <h2 className="section-title m0" id="preset-title">
          How much your agents may do on their own
        </h2>
        <ul className="plain-list stack">
          {PRESETS.map((p) => (
            <li key={p} className="row wrap">
              <span className="wrap">
                {o.policy.preset === p ? (
                  <strong>{PRESET_TEXT[p]} (current)</strong>
                ) : (
                  PRESET_TEXT[p]
                )}
              </span>
              {o.policy.preset === p ? null : (
                <ApprovalAction
                  projectId={pid}
                  path=""
                  method="PUT"
                  body={withPreset(p)}
                  label={`Use ${p}`}
                  done="Policy changed."
                />
              )}
            </li>
          ))}
        </ul>
        <p className="muted m0">
          Locked actions (turning off Guard or the done gate, removing protected folders or security
          rules, changing this policy) are always asked.
        </p>
        <span className="row wrap">
          {paused ? (
            <>
              <span>
                Automatic approvals are paused until{" "}
                {new Date(o.policy.pausedUntil ?? "").toUTCString()}.
              </span>
              <ApprovalAction
                projectId={pid}
                path="pause"
                body={{ hours: null }}
                label="End the pause"
                done="Pause ended."
              />
            </>
          ) : (
            [1, 2, 4].map((h) => (
              <ApprovalAction
                key={h}
                projectId={pid}
                path="pause"
                body={{ hours: h }}
                label={`Pause for ${h} hour${h === 1 ? "" : "s"}`}
                done="Paused: everything is asked."
                variant="ghost"
              />
            ))
          )}
        </span>
      </section>

      <section className="card stack" aria-labelledby="auto-title">
        <h2 className="section-title m0" id="auto-title">
          Done on their own lately
        </h2>
        {o.automatic.length === 0 ? (
          <p className="muted m0">Nothing yet.</p>
        ) : (
          <ul className="plain-list stack">
            {o.automatic.map((r) => (
              <li key={r.id} className="row wrap">
                <span className="wrap">
                  {r.action.replaceAll("_", " ")}
                  {r.feature ? ` in ${r.feature}` : ""}: {r.summary}
                </span>
                {r.undone ? (
                  <span className="muted">Undone</span>
                ) : (
                  <ApprovalAction
                    projectId={pid}
                    path="undo"
                    body={{ requestId: r.id }}
                    label="Undo"
                    done="Marked as undone."
                    variant="ghost"
                    ariaLabel={`Undo: ${r.summary}`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {mode === "detailed" ? (
        <section className="card stack" aria-labelledby="table-title">
          <h2 className="section-title m0" id="table-title">
            Every action, by preset
          </h2>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Risk</th>
                  <th scope="col">Careful</th>
                  <th scope="col">Balanced</th>
                  <th scope="col">Fast</th>
                </tr>
              </thead>
              <tbody>
                {view.table.map((t) => (
                  <tr key={t.action}>
                    <td>{t.label}</td>
                    <td>{RISK_LABEL[t.risk]}</td>
                    <td>{CHOICE_LABELS[t.careful]}</td>
                    <td>{CHOICE_LABELS[t.balanced]}</td>
                    <td>{CHOICE_LABELS[t.fast]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className="m0">Your rules ({o.policy.rules.length})</h3>
          {o.policy.rules.length === 0 ? (
            <p className="muted m0">No rules: the preset decides.</p>
          ) : (
            <ul className="plain-list stack">
              {o.policy.rules.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rules have no id; their order is their meaning
                <li key={i} className="wrap">
                  {CHOICE_LABELS[r.choice]}:{" "}
                  {r.action && r.action !== "*" ? r.action.replaceAll("_", " ") : "any action"}
                  {r.feature ? `, feature ${r.feature}` : ""}
                  {r.path ? `, path ${r.path}` : ""}
                  {r.agent ? `, agent ${r.agent}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}
