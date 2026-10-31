"use client";

import { type ReactNode, useState } from "react";

// A <details> whose body is rendered only once it has been opened: a page of closed cards stays small, so opening one
// lays out one card instead of every card on the page (INP).
export function Disclosure({
  open = false,
  summary,
  children,
}: {
  open?: boolean;
  summary: ReactNode;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(open);
  return (
    <details
      open={open}
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="disclosure-summary">{summary}</summary>
      {opened ? <div className="disclosure-body">{children}</div> : null}
    </details>
  );
}
