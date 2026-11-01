import { StatusBadge } from "@/components/ui/status-badge";
import type { ReactNode } from "react";
import { HERO_ASKED, HERO_CHECKS, HERO_EVIDENCE, HERO_ITEMS, type ReceiptLine } from "./content";

// The receipt: white paper with a torn bottom edge and monospace text, the landing page's signature element. Every
// status is an icon and a word (StatusBadge); paths are monospace; secrets are masked.

/** A sheet of receipt paper with a torn bottom edge (drawn in CSS); the content is monospace. */
export function Paper({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`paper ${className}`.trim()}>{children}</div>;
}

// A receipt line that explains itself: hover or focus shows the tip (CSS only, so it costs no JavaScript).
function Explained({
  id,
  tip,
  children,
}: {
  id: string;
  tip: string;
  children: ReactNode;
}) {
  return (
    <li className="rc-line">
      <button type="button" className="rc-explain" aria-describedby={`tip-${id}`}>
        {children}
      </button>
      <span role="tooltip" id={`tip-${id}`} className="rc-tip">
        {tip}
      </span>
    </li>
  );
}

function Item({ line }: { line: ReceiptLine }) {
  return (
    <Explained id={line.id} tip={line.tip}>
      <StatusBadge status={line.status} label={line.label} />
      <span className="rc-text">
        {line.text}
        {line.text && line.path ? " " : null}
        {line.path ? <span className="rc-path">{line.path}</span> : null}
      </span>
    </Explained>
  );
}

export function HeroReceipt() {
  return (
    <figure className="hero-receipt" aria-labelledby="hero-receipt-caption">
      <div className="printer" aria-hidden="true">
        <span className="printer-slot" />
      </div>
      <div className="print-window">
        <div className="print-paper">
          <Paper>
            <div className="rc-head">
              <strong>Receipt</strong>
              <span>salon-booking · Claude Code</span>
            </div>
            <ul className="rc-list">
              <Explained id="asked" tip={HERO_ASKED.tip}>
                <span className="rc-label">Asked</span>
                <span className="rc-text">“{HERO_ASKED.text}”</span>
              </Explained>
            </ul>
            <ul className="rc-list">
              {HERO_ITEMS.map((l) => (
                <Item key={l.id} line={l} />
              ))}
            </ul>
            <p className="rc-label rc-section">Checks</p>
            <ul className="rc-list">
              {HERO_CHECKS.map((l) => (
                <Item key={l.id} line={l} />
              ))}
            </ul>
            <p className="rc-label rc-section">Evidence (no source code)</p>
            <ul className="rc-list">
              <Explained id="evidence" tip={HERO_EVIDENCE.tip}>
                <span className="rc-text">{HERO_EVIDENCE.text}</span>
              </Explained>
            </ul>
          </Paper>
        </div>
      </div>
      <figcaption id="hero-receipt-caption" className="lp-visually-hidden">
        A sample receipt. Hover or focus a line to see what it means.
      </figcaption>
    </figure>
  );
}
