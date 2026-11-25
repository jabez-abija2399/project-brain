import { getSessionUser, isPlausibleId } from "@/server/auth";
import { getDb } from "@/server/db";
import { navCounts } from "@/server/nav-counts";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { NavCountsProvider } from "./nav-counts";

// FEAT-030: the counts on the Receipts and To decide tabs, for the signed-in owner only. Anyone else gets none (and
// the page itself answers 404); a failure to count never breaks the page.
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let counts = null;
  try {
    const user = await getSessionUser(
      new Request("http://localhost/", { headers: await headers() }),
    );
    if (user && isPlausibleId(id)) counts = await navCounts(getDb(), user, id);
  } catch {
    counts = null;
  }
  return <NavCountsProvider value={counts}>{children}</NavCountsProvider>;
}
