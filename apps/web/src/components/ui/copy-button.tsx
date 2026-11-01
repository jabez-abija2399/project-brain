"use client";

import { copyText } from "@/lib/ui-helpers";
import { useState } from "react";

// Copies text to the clipboard and says so; if the browser refuses, it says what to do instead.
export function CopyButton({
  text,
  label,
  variant = "secondary",
}: {
  text: string;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    setState(await copyText(text));
  }
  return (
    <span className="row">
      <button type="button" className={`btn btn-${variant}`} onClick={copy} data-copy={text}>
        {label}
      </button>
      <output aria-live="polite" className="muted">
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed: select the text and copy it by hand."
            : ""}
      </output>
    </span>
  );
}
