"use client";

import { EXAMPLE_CODE, EXAMPLE_EVIDENCE } from "@/lib/ui-helpers";
import { useState } from "react";

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
