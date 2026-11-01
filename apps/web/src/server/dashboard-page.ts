import type { BrainDb } from "@brain/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { type SessionUser, getSessionUser } from "./auth";
import { pageNumber } from "./dashboard";
import { getDb } from "./db";
import { AppError } from "./errors";

// Dashboard pages resolve the signed-in user the same way the API routes do (one session resolver).
export async function pageUser(): Promise<SessionUser> {
  const user = await getSessionUser(new Request("http://localhost/", { headers: await headers() }));
  if (!user) redirect("/");
  return user;
}

// A project the user may not see (another user's, or none) is the 404 page, never a different message (AC-017-04).
export async function orNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }
}

export type ListPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[]; sort?: string | string[] }>;
};

/**
 * One paginated list page: the signed-in user, ?page=N and the project's data, or the 404 page. A page past the end
 * (a stale link) shows the last page instead of an empty list.
 */
export async function loadListPage<T extends { rows: unknown[]; total: number; pages: number }>(
  props: ListPageProps,
  load: (db: BrainDb, user: SessionUser, projectId: string, page: number) => Promise<T>,
): Promise<T> {
  const [{ id }, { page }] = await Promise.all([props.params, props.searchParams]);
  const user = await pageUser();
  const n = pageNumber(page);
  const result = await orNotFound(() => load(getDb(), user, id, n));
  if (result.rows.length === 0 && result.total > 0 && n > result.pages) {
    return orNotFound(() => load(getDb(), user, id, result.pages));
  }
  return result;
}
