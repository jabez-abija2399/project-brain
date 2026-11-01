"use client";

import { copyText } from "@/components/ui/copy-button";
import { useEffect, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

/** The copy button's word for each state. */
export function copyLabel(state: CopyState): string {
  return state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy";
}

// A terminal command in a box with a copy button that says "Copied" (or how to copy by hand). Monospace inside only.
export function CommandBox({
  command,
  tone = "light",
}: { command: string; tone?: "light" | "ink" }) {
  const [state, setState] = useState<CopyState>("idle");
  // The word goes back to "Copy" after a moment, so a second copy is acknowledged again.
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <div className={`command-box command-${tone}`}>
      <code className="command-text">
        <span aria-hidden="true" className="command-prompt">
          ${" "}
        </span>
        {command}
      </code>
      <button
        type="button"
        className="command-copy"
        data-copy={command}
        aria-label={state === "idle" ? `Copy ${command}` : copyLabel(state)}
        onClick={async () => setState(await copyText(command))}
      >
        {copyLabel(state)}
      </button>
      <output aria-live="polite" className="lp-visually-hidden">
        {state === "copied"
          ? "Copied to the clipboard"
          : state === "failed"
            ? "Copy failed: select the command and copy it by hand."
            : ""}
      </output>
    </div>
  );
}
