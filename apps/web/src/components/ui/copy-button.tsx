"use client";

import { useState } from "react";

type Clipboard = { writeText(text: string): Promise<void> };

/** Copies text; "failed" when the browser has no clipboard or refuses (the button then says what to do instead). */
export async function copyText(
  text: string,
  clipboard: Clipboard | undefined = globalThis.navigator?.clipboard,
): Promise<"copied" | "failed"> {
  try {
    if (!clipboard) return "failed";
    await clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}

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
