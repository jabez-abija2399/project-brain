import { StatusBadge } from "@/components/ui/status-badge";
import { When } from "@/components/ui/when";
import {
  ACTION_LABELS,
  CHOICE_LABELS,
  PRESET_TEXT,
  type approvalsPage,
} from "@/server/approvals-page";
import { ApprovalAction } from "./approval-actions";
import { RequestDecision } from "./request-decision";

// FEAT-030: the Approvals page in two parts, so the To decide tab shows the waiting requests and Settings shows what
// agents may do on their own. Both act only through the owner's routes (approval-actions.tsx).
type View = Awaited<ReturnType<typeof approvalsPage>>;
type Ready = Extract<View["overview"], { ready: true }>;

const PRESETS = ["careful", "balanced", "fast"] as const;
export const RISK_LABEL = { low: "Low", medium: "Medium", high: "High", locked: "Locked" } as const;

// FEAT-040 (design v3): why a request waits for the owner, in one plain sentence per risk level (Stripe Radar's
// "risk insights"), next to what it touches.
const WHY: Record<string, string> = {
  high: "It can remove work or data that is hard to get back.",
  medium: "It changes more than a normal edit, so your settings keep it for you.",
  low: "Your settings keep this kind of action for you.",
  locked: "Your settings never let an agent do this on its own.",
};
const RISK_TONE: Record<string, "missed" | "warning" | "neutral"> = {
  high: "missed",
  locked: "missed",
  medium: "warning",
  low: "neutral",
};

export function PendingRequests({
  pid,
  o,
  bare = false,
}: { pid: string; o: Ready; bare?: boolean }) {
  // FEAT-039: on To decide the requests are plain cards in the one list (the page gives the heading and count).
  if (bare) return <RequestCards pid={pid} o={o} />;
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
        <RequestCards pid={pid} o={o} />
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

function RequestCards({ pid, o }: { pid: string; o: Ready }) {
  return (
    <ul className="plain-list stack">
      {o.pending.map((r) => {
        // FEAT-035: the action as a sentence, and an expired request says so instead of offering buttons.
        const sentence =
          ACTION_LABELS[r.action as keyof typeof ACTION_LABELS] ?? r.action.replaceAll("_", " ");
        const expired = new Date(r.expiresAt).getTime() <= Date.now();
        return (
          <li key={r.id} className="card stack" data-request={r.id}>
            <StatusBadge
              status={RISK_TONE[r.risk] ?? "neutral"}
              label={`${RISK_LABEL[r.risk as keyof typeof RISK_LABEL] ?? r.risk} risk`}
            />
            <span className="wrap">
              <span className="muted">Your agent wants to: </span>
              <strong>{sentence}</strong>
              {r.feature ? ` in ${r.feature}` : ""}
              {r.path ? ` (${r.path})` : ""}
            </span>
            <span className="muted wrap">
              Agent says: <q>{r.summary}</q>
            </span>
            <span className="muted">
              {RISK_LABEL[r.risk as keyof typeof RISK_LABEL] ?? r.risk} risk
              {r.agent ? `, asked by ${r.agent}` : ""}
              {expired ? null : (
                <>
                  , expires <When iso={r.expiresAt} />
                </>
              )}
            </span>
            <div className="why" data-testid="why-asking">
              <h3 className="subhead m0">Why we're asking</h3>
              <ul className="m0">
                <li>{WHY[r.risk] ?? WHY.low}</li>
                {r.path ? (
                  <li>
                    It touches <code>{r.path}</code>
                  </li>
                ) : null}
                {r.feature ? <li>Feature: {r.feature}</li> : null}
              </ul>
            </div>
            {expired ? (
              <p className="m0" data-testid="request-expired">
                This request expired. Your agent can ask again if it still needs it.
              </p>
            ) : (
              <RequestDecision projectId={pid} requestId={r.id} summary={r.summary} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
