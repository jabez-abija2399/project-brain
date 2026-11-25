"use client";

import { type ReactNode, createContext, useContext } from "react";

// FEAT-030: the counts on the Receipts and To decide tabs, loaded once by the project layout (server, owner only).
export type NavCounts = { receipts: number; decide: number };
const Counts = createContext<NavCounts | null>(null);

export function NavCountsProvider({
  value,
  children,
}: { value: NavCounts | null; children?: ReactNode }) {
  return <Counts.Provider value={value}>{children}</Counts.Provider>;
}

export function TabBadge({ of }: { of: keyof NavCounts }) {
  const n = useContext(Counts)?.[of] ?? 0;
  if (n <= 0) return null;
  const label = of === "receipts" ? `${n} need your attention` : `${n} waiting for you`;
  return (
    <span className="tab-badge" aria-label={label} title={label}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
