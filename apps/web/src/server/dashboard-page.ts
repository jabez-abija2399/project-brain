import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { type SessionUser, getSessionUser } from "./auth";
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
