import { When } from "@/components/ui/when";
import { CHOICE_LABELS, PRESET_TEXT, type approvalsPage } from "@/server/approvals-page";
import { ApprovalAction } from "./approval-actions";

// FEAT-030: the Approvals page in two parts, so the To decide tab shows the waiting requests and Settings shows what
// agents may do on their own. Both act only through the owner's routes (approval-actions.tsx).
type View = Awaited<ReturnType<typeof approvalsPage>>;
type Ready = Extract<View["overview"], { ready: true }>;

const PRESETS = ["careful", "balanced", "fast"] as const;
export const RISK_LABEL = { low: "Low", medium: "Medium", high: "High", locked: "Locked" } as const;

export function PendingRequests({ pid, o }: { pid: string; o: Ready }) {
  return (
    <section className="card stack" aria-labelledby="pending-title">
      <h2 className="section-title m0" id="pending-title">
        {o.pending.length > 0
          ? `Waiting for you: ${o.pending.length}`
          : "Nothing is waiting for you"}
      </h2>
      {o.pending.length === 0 ? (
        <p className="muted m0">
          When an agent asks for something your policy keeps for you, it shows here. Requests expire
          after 24 hours.
        </p>
      ) : (
        <ul className="plain-list stack">
          {o.pending.map((r) => (
            <li key={r.id} className="stack">
              <span className="wrap">
                <strong>{r.action.replaceAll("_", " ")}</strong>
                {r.feature ? ` in ${r.feature}` : ""}
                {r.path ? ` (${r.path})` : ""}
              </span>
              <span className="muted wrap">
                Agent says: <q>{r.summary}</q>
              </span>
              <span className="muted">
                {RISK_LABEL[r.risk as keyof typeof RISK_LABEL] ?? r.risk} risk
                {r.agent ? `, asked by ${r.agent}` : ""}, expires <When iso={r.expiresAt} />
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
                  ariaLabel={`Always approve this kind: ${r.summary}`}
                  done="Approved, and remembered."
                  variant="ghost"
                />
                <ApprovalAction
                  projectId={pid}
                  path="decide"
                  body={{ requestId: r.id, decision: "reject", remember: true }}
                  label="Always reject this kind"
                  ariaLabel={`Always reject this kind: ${r.summary}`}
                  done="Rejected, and remembered."
                  variant="ghost"
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ApprovalPolicy({
  pid,
  o,
  table,
  mode,
}: {
  pid: string;
  o: Ready;
  table: View["table"];
  mode: "simple" | "detailed";
}) {
  const paused = o.policy.pausedUntil && new Date(o.policy.pausedUntil).getTime() > Date.now();
  const withPreset = (preset: (typeof PRESETS)[number]) => ({ preset });
  return (
    <>
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
                Automatic approvals are paused, back on <When iso={o.policy.pausedUntil} />.
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
                {table.map((t) => (
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
    </>
  );
}
