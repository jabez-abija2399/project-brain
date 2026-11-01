"use client";

import { useState } from "react";

// The one example behind "What leaves your machine": a code change and the exact evidence line made from it.
export const EXAMPLE_CODE = [
  "// Payments are only called from checkout.",
  "// Prices come from the server, never the browser.",
  "// Refunds go through the dashboard for now.",
  "// Keep UI code out of this file.",
  "// Owner: billing.",
];
export const EXAMPLE_EVIDENCE =
  "src/lib/payments.ts: +5 -0, comment only, top of file (outside the request's feature)";

// A toggle that puts the code on your computer next to the evidence line that is sent instead.
export function PrivacyToggle() {
  const [open, setOpen] = useState(false);
  return (
    <div className="privacy-example">
      <button
        type="button"
        className="btn btn-secondary"
        aria-pressed={open}
        aria-controls="privacy-compare"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide the example" : "Show an evidence line next to its code"}
      </button>
      <div id="privacy-compare" className="privacy-compare" hidden={!open}>
        <figure className="compare-side compare-code">
          <figcaption>Stays on your computer</figcaption>
          <pre>
            <code>
              <span className="compare-file">src/lib/payments.ts</span>
              {"\n"}
              {EXAMPLE_CODE.map((l) => `+ ${l}`).join("\n")}
            </code>
          </pre>
        </figure>
        <figure className="compare-side compare-sent">
          <figcaption>Sent to Codeceipt</figcaption>
          <pre>
            <code>{EXAMPLE_EVIDENCE}</code>
          </pre>
        </figure>
      </div>
    </div>
  );
}
