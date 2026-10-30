import { StatusBadge } from "@/components/ui/status-badge";
import type { ReactNode } from "react";

// The landing page's sample receipt, printing out of a slot: the page's one bold element. Written the way the product
// writes receipts (FEAT-013/015/018): every status is an icon and a word, paths are monospace, secrets are masked.

// Torn paper: a zig-zag bottom edge as a clip-path polygon (no image, no extra markup).
const TEETH = 28;
const DEPTH = "8px";
const ZIGZAG = `polygon(0 0, 100% 0, ${Array.from({ length: TEETH + 1 }, (_, n) => {
  const i = TEETH - n;
  const x = `${((i / TEETH) * 100).toFixed(3)}%`;
  return `${x} ${i % 2 === 0 ? `calc(100% - ${DEPTH})` : "100%"}`;
}).join(", ")})`;

function Line({ badge, children }: { badge: ReactNode; children: ReactNode }) {
  return (
    <li className="lp-r-line">
      {badge}
      <span className="wrap">{children}</span>
    </li>
  );
}

export function Receipt() {
  return (
    <figure className="lp-receipt" id="receipt" aria-label="A sample receipt">
      <div className="lp-printer" aria-hidden="true">
        <span className="lp-slot" />
      </div>
      <div className="lp-paper-window">
        <div className="lp-paper">
          <div className="lp-paper-inner mono" style={{ clipPath: ZIGZAG }}>
            <div className="lp-r-head">
              <strong className="lp-r-title">Receipt</strong>
              <span>salon-booking</span>
              <span>Session ended 14:32</span>
            </div>
            <div className="lp-r-block">
              <span className="lp-r-label">Asked</span>
              <p className="lp-r-text">
                Add a reviews section to each salon page, sorted newest first.
              </p>
            </div>
            <ul className="lp-r-list">
              <Line badge={<StatusBadge status="done" />}>
                Reviews list on the salon page{" "}
                <span className="lp-r-path">src/pages/Salon.tsx:42</span>
              </Line>
              <Line badge={<StatusBadge status="done" />}>
                Reused StarRating instead of creating a new one
              </Line>
              <Line badge={<StatusBadge status="missed" />}>Reviews are not sorted by newest</Line>
              <Line badge={<StatusBadge status="warning" label="Outside scope" />}>
                <span className="lp-r-path">src/lib/payments.ts</span> was changed
              </Line>
            </ul>
            <div className="lp-r-block">
              <span className="lp-r-label">Checks</span>
              <ul className="lp-r-list">
                <Line badge={<StatusBadge status="missed" label="Secret" />}>
                  Secret found: sb_s*** in <span className="lp-r-path">src/lib/supabase.ts:3</span>,
                  move it to the server
                </Line>
                <Line badge={<StatusBadge status="missed" label="RLS" />}>
                  Table reviews: RLS is off
                </Line>
                <Line badge={<StatusBadge status="warning" label="Tests" />}>
                  1 test was skipped: <span className="lp-r-path">reviews.test.ts</span>
                </Line>
              </ul>
            </div>
            <div className="lp-r-block">
              <ul className="lp-r-list">
                <Line badge={<StatusBadge status="not_verified" />}>Sorting has no test</Line>
              </ul>
            </div>
            <div className="lp-r-foot">
              {/* Part of the illustration: in the app this copies a fix prompt for the agent. */}
              <span className="btn btn-primary lp-r-action">Send fix to agent</span>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="lp-visually-hidden">
        A sample receipt: two items done, one missed, one file changed outside the request, three
        checks to fix, and one item not verified.
      </figcaption>
    </figure>
  );
}
