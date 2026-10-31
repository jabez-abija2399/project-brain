import { NO_REQUEST_NOTE, NO_SNAPSHOT_NOTE, type ReceiptView } from "@brain/core";
import type { ReactNode } from "react";
import { ChecklistItem } from "./checklist-item";
import { CodeRef } from "./code-ref";
import { CopyButton } from "./ui/copy-button";
import { Disclosure } from "./ui/disclosure";
import { StatusBadge } from "./ui/status-badge";

export type ReceiptCardData = {
  id: string;
  createdAt: string;
  asked: string | null;
  commitSha: string | null;
  view: ReceiptView;
  fixPrompt: string | null;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="stack" style={{ gap: 6 }}>
      <h3 style={{ fontSize: 13, margin: 0 }}>{title}</h3>
      {children}
    </section>
  );
}

/** Something on the receipt needs the user: missed or partly done items, findings, test checks, edits outside scope. */
export function needsAttention(view: ReceiptView): boolean {
  return (
    view.items.some((i) => i.status === "missed" || i.status === "partial") ||
    view.findings.length + view.findingsOmitted > 0 ||
    view.testChecks.length > 0 ||
    view.outsideScope.length > 0
  );
}

// One receipt: what was asked, what got done, partly done or missed, edits outside the request's feature, security
// findings and what could not be verified. Collapsed to its summary line until opened; the body is rendered on first
// open, so a page of receipts stays small and a click stays fast (INP).
export function ReceiptCard({
  receipt,
  expanded = false,
}: { receipt: ReceiptCardData; expanded?: boolean }) {
  const { view } = receipt;
  const count = (s: string) => view.items.filter((i) => i.status === s).length;
  const missed = count("missed") + count("partial");
  return (
    <article
      id={`receipt-${receipt.id}`}
      className={`card${missed > 0 ? " card-highlighted" : ""}`}
      data-testid="receipt-card"
    >
      <Disclosure
        open={expanded}
        summary={
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted">
              <time dateTime={receipt.createdAt}>
                {receipt.createdAt.slice(0, 16).replace("T", " ")} UTC
              </time>
              {receipt.commitSha && (
                <>
                  {" · "}
                  <code>{receipt.commitSha}</code>
                </>
              )}
            </span>
            <strong className="wrap">
              {view.noRequest
                ? NO_REQUEST_NOTE
                : receipt.asked
                  ? `Asked: ${receipt.asked}`
                  : "Asked: (request removed)"}
            </strong>
            <span className="row">
              <StatusBadge status="done" label={`${count("done")} done`} />
              {count("done_untested") > 0 && (
                <StatusBadge
                  status="done_untested"
                  label={`${count("done_untested")} done, no test proves it`}
                />
              )}
              <StatusBadge status="partial" label={`${count("partial")} partly done`} />
              <StatusBadge status="missed" label={`${count("missed")} missed`} />
              {count("question") > 0 && (
                <StatusBadge
                  status="question"
                  label={`${count("question")} question${count("question") === 1 ? "" : "s"}`}
                />
              )}
              {view.outsideScope.length > 0 && (
                <StatusBadge status="warning" label={`${view.outsideScope.length} outside scope`} />
              )}
              {view.findings.length + view.findingsOmitted > 0 && (
                <StatusBadge
                  status="missed"
                  label={`${view.findings.length + view.findingsOmitted} findings`}
                />
              )}
              {view.testChecks.length > 0 && (
                <StatusBadge status="missed" label={`${view.testChecks.length} test checks`} />
              )}
              {view.notVerified.length > 0 && (
                <StatusBadge
                  status="not_verified"
                  label={`${view.notVerified.length} not verified`}
                />
              )}
            </span>
          </div>
        }
      >
        <div className="stack" style={{ marginTop: 16 }}>
          {view.noSnapshot && (
            <p className="muted wrap" style={{ margin: 0 }}>
              {NO_SNAPSHOT_NOTE}
            </p>
          )}
          {view.filesByFeature.length > 0 && (
            <Section title="Changed files by feature">
              <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }}>
                {view.filesByFeature.map((g) => (
                  <li key={g.feature}>
                    <span>{g.feature}: </span>
                    {g.files.map((f, n) => (
                      <span key={f}>
                        {n > 0 ? ", " : ""}
                        <code className="wrap">{f}</code>
                        {view.alreadyModified.includes(f) && (
                          <>
                            {" "}
                            <span className="muted">(already modified before the session)</span>
                          </>
                        )}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Checklist">
            {view.items.length === 0 ? (
              <p className="muted">
                {view.noRequest
                  ? "No checklist: the agent did not record your request."
                  : "No checklist items were open for this request."}
              </p>
            ) : (
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {view.items.map((i, n) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: items have no stable id in a stored receipt
                  <ChecklistItem key={n} {...i} />
                ))}
              </ul>
            )}
          </Section>
          {view.outsideScope.length > 0 && (
            <Section title="Changed outside the request's feature">
              <span className="row">
                {view.outsideScope.map((p) => (
                  <CodeRef key={p} path={p} />
                ))}
              </span>
            </Section>
          )}
          {view.findings.length > 0 && (
            <Section title="Security findings">
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {view.findings.map((f, n) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: findings have no stable id in a stored receipt
                  <li key={n} className="stack" style={{ gap: 2 }}>
                    <span className="row">
                      <StatusBadge status="missed" label={f.type.replaceAll("_", " ")} />
                      {f.file && <CodeRef path={f.file} line={f.line} />}
                      {f.maskedValue && <code>{f.maskedValue}</code>}
                    </span>
                    <span className="muted wrap">{f.hint}</span>
                  </li>
                ))}
              </ul>
              {view.findingsOmitted > 0 && (
                <p className="muted">…and {view.findingsOmitted} more.</p>
              )}
            </Section>
          )}
          {view.findingsBeforeSession.length > 0 && (
            <Section title="Already in your working tree before this session">
              <p className="muted" style={{ margin: 0 }}>
                Found in files you had already changed before this session: not the agent's change.
              </p>
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {view.findingsBeforeSession.map((f, n) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: findings have no stable id in a stored receipt
                  <li key={n} className="stack" style={{ gap: 2 }}>
                    <span className="row">
                      <StatusBadge status="warning" label={f.type.replaceAll("_", " ")} />
                      {f.file && <CodeRef path={f.file} line={f.line} />}
                      {f.maskedValue && <code>{f.maskedValue}</code>}
                    </span>
                    <span className="muted wrap">{f.hint}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {(view.testChecks.length > 0 || view.passing.before !== null) && (
            <Section title="Test checks">
              {view.passing.before !== null && view.passing.after !== null && (
                <p className="muted" style={{ margin: 0 }}>
                  Passing tests: {view.passing.before} before, {view.passing.after} after
                </p>
              )}
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {view.testChecks.map((c, n) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: checks have no stable id in a stored receipt
                  <li key={n} className="stack" style={{ gap: 2 }}>
                    <span className="row">
                      <StatusBadge status="missed" label={`${c.label} (${c.count})`} />
                      {c.file && <CodeRef path={c.file} />}
                    </span>
                    {c.names.length > 0 && (
                      <span className="muted wrap">{c.names.join(" · ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {view.notVerified.length > 0 && (
            <Section title="Not verified">
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {view.notVerified.map((n, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: entries have no stable id in a stored receipt
                  <li key={i} className="row">
                    <StatusBadge status="not_verified" />
                    <span className="wrap">{n.text}</span>
                    {n.reason && <span className="muted">({n.reason})</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {receipt.fixPrompt && (
            <CopyButton text={receipt.fixPrompt} label="Send fix to agent" variant="primary" />
          )}
        </div>
      </Disclosure>
    </article>
  );
}
