import type { ReceiptView } from "@brain/core";
import type { ReactNode } from "react";
import { ChecklistItem } from "./checklist-item";
import { CodeRef } from "./code-ref";
import { CopyButton } from "./ui/copy-button";
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

// One receipt: what was asked, what got done, partly done or missed, edits outside the request's feature, security
// findings and what could not be verified. Collapsed to its summary line until opened.
export function ReceiptCard({
  receipt,
  expanded = false,
}: { receipt: ReceiptCardData; expanded?: boolean }) {
  const { view } = receipt;
  const count = (s: string) => view.items.filter((i) => i.status === s).length;
  const missed = count("missed") + count("partial");
  return (
    <article className={`card${missed > 0 ? " card-highlighted" : ""}`} data-testid="receipt-card">
      <details open={expanded}>
        <summary style={{ cursor: "pointer", listStyle: "none" }}>
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
              {receipt.asked ? `Asked: ${receipt.asked}` : "Asked: (request removed)"}
            </strong>
            <span className="row">
              <StatusBadge status="done" label={`${count("done")} done`} />
              <StatusBadge status="partial" label={`${count("partial")} partly done`} />
              <StatusBadge status="missed" label={`${count("missed")} missed`} />
              {view.outsideScope.length > 0 && (
                <StatusBadge status="warning" label={`${view.outsideScope.length} outside scope`} />
              )}
              {view.findings.length + view.findingsOmitted > 0 && (
                <StatusBadge
                  status="missed"
                  label={`${view.findings.length + view.findingsOmitted} findings`}
                />
              )}
              {view.notVerified.length > 0 && (
                <StatusBadge
                  status="not_verified"
                  label={`${view.notVerified.length} not verified`}
                />
              )}
            </span>
          </div>
        </summary>
        <div className="stack" style={{ marginTop: 16 }}>
          <Section title="Checklist">
            {view.items.length === 0 ? (
              <p className="muted">No checklist items were open for this request.</p>
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
                      <CodeRef path={f.file} line={f.line} />
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
          {view.notVerified.length > 0 && (
            <Section title="Not verified">
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {view.notVerified.map((n, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: entries have no stable id in a stored receipt
                  <li key={i} className="row">
                    <StatusBadge status="not_verified" />
                    <span className="wrap">{n.text}</span>
                    <span className="muted">({n.reason})</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {receipt.fixPrompt && (
            <CopyButton text={receipt.fixPrompt} label="Send fix to agent" variant="primary" />
          )}
        </div>
      </details>
    </article>
  );
}
