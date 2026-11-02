import { headers } from "next/headers";
import { getSessionUser } from "./auth";

/**
 * Owner, 2026-11-02: whether the visitor of a public page is signed in, so its header and footer never offer
 * "Sign in" to someone who already is. A failed session lookup counts as signed out (the page still renders).
 */
export async function isSignedIn(): Promise<boolean> {
  try {
    return (
      (await getSessionUser(new Request("http://localhost/", { headers: await headers() }))) !==
      null
    );
  } catch {
    return false;
  }
}
