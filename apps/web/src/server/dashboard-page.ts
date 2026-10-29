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
  searchParams: Promise<{ page?: string | string[] }>;
};

/** One paginated list page: the signed-in user, ?page=N and the project's data, or the 404 page. */
export async function loadListPage<T>(
  props: ListPageProps,
  load: (db: BrainDb, user: SessionUser, projectId: string, page: number) => Promise<T>,
): Promise<T> {
  const [{ id }, { page }] = await Promise.all([props.params, props.searchParams]);
  const user = await pageUser();
  return orNotFound(() => load(getDb(), user, id, pageNumber(page)));
}
