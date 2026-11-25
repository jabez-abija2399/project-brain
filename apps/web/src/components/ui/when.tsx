"use client";

import { formatDay, formatFull, formatRelative } from "@/lib/when";
import { useEffect, useState } from "react";

// FEAT-028: a date people read. The server renders a time-zone-free form ("3 hours ago", "12 Nov 2026"); after it
// loads, the browser shows its own time zone ("Today 14:19") with the full date and time on hover.
export function When({
  iso,
  format = "relative",
  className,
}: {
  iso: string | null | undefined;
  format?: "relative" | "day";
  className?: string;
}) {
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(true), []);
  if (!iso) return null;
  const text = format === "day" ? formatDay(iso, local) : formatRelative(iso, new Date(), local);
  return (
    <time className={className} dateTime={iso} title={formatFull(iso, local)}>
      {text}
    </time>
  );
}
