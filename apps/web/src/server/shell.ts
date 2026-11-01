import { safeDisplay } from "@brain/core";
import { projectsRepo } from "@brain/db";
import { headers } from "next/headers";
import { getSessionUser } from "./auth";
import { getDb } from "./db";

const MAX_SWITCHER = 50;

export type ShellData = {
  user: { name: string; email: string } | null;
  projects: { id: string; name: string }[];
};

/** What the app shell shows: who is signed in and their own projects (projectsRepo.listByOwner), or nobody. */
export async function shellData(): Promise<ShellData> {
  const user = await getSessionUser(new Request("http://localhost/", { headers: await headers() }));
  if (!user) return { user: null, projects: [] };
  const { items } = await projectsRepo.listByOwner(getDb(), user.id, { limit: MAX_SWITCHER });
  return {
    user: { name: safeDisplay(user.name || user.email, 60), email: safeDisplay(user.email, 200) },
    projects: items.map((p) => ({ id: p.id, name: safeDisplay(p.name, 100) })),
  };
}
