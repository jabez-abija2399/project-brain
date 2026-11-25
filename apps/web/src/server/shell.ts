import { CELEBRATE_COOKIE, celebrationsOn } from "@/lib/celebrate";
import { currentProjectId } from "@/lib/ui-helpers";
import { safeDisplay } from "@brain/core";
import { projectsRepo } from "@brain/db";
import { cookies, headers } from "next/headers";
import { getSessionUser } from "./auth";
import { getDb } from "./db";
import { navCounts } from "./nav-counts";

const MAX_SWITCHER = 50;

export type ShellData = {
  user: { name: string; email: string } | null;
  projects: { id: string; name: string }[];
  /** FEAT-033: false when this browser turned celebrations off (Account page). */
  celebrate?: boolean;
  /**
   * FEAT-040: the sidebar's counts for the project in the address, only when it is one of the user's own projects
   * (anything else gets none, and the page itself answers 404).
   */
  counts?: { projectId: string; receipts: number; decide: number } | null;
};

async function celebrateCookie(): Promise<boolean> {
  try {
    return celebrationsOn((await cookies()).get(CELEBRATE_COOKIE)?.value);
  } catch {
    return true;
  }
}

/** What the app shell shows: who is signed in and their own projects (projectsRepo.listByOwner), or nobody. */
export async function shellData(): Promise<ShellData> {
  const h = await headers();
  const user = await getSessionUser(new Request("http://localhost/", { headers: h }));
  if (!user) return { user: null, projects: [] };
  const db = getDb();
  const { items } = await projectsRepo.listByOwner(db, user.id, { limit: MAX_SWITCHER });
  const current = currentProjectId(h.get("x-codeceipt-path"));
  let counts: ShellData["counts"] = null;
  if (current && items.some((p) => p.id === current)) {
    try {
      counts = { projectId: current, ...(await navCounts(db, user, current)) };
    } catch {
      // A failure to count never breaks the page.
      counts = null;
    }
  }
  return {
    user: { name: safeDisplay(user.name || user.email, 60), email: safeDisplay(user.email, 200) },
    projects: items.map((p) => ({ id: p.id, name: safeDisplay(p.name, 100) })),
    celebrate: await celebrateCookie(),
    counts,
  };
}
