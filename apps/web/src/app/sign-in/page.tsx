import SignInButton from "@/app/sign-in-button";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { safeNextPath } from "@/lib/safe-path";
import { getSessionUser } from "@/server/auth";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in | Codeceipt", robots: { index: false } };

// The sign-in page (2026-11-01): one button, what Codeceipt reads from GitHub and why, and a way back to the page the
// visitor came from (a path on this site only, checked by safeNextPath).
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const raw = (await searchParams).next;
  const next = safeNextPath(Array.isArray(raw) ? raw[0] : raw);
  const user = await getSessionUser(new Request("http://localhost/", { headers: await headers() }));
  if (user) redirect(next);
  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <SiteHeader home="/" />
      <main id="content" className="shell-body page page-narrow">
        <div className="signin-card">
          <h1>Sign in to Codeceipt</h1>
          <p className="purpose">Use your GitHub account. There is no separate password.</p>
          <SignInButton tone="primary" callbackURL={next} />
          <section aria-labelledby="access" className="stack">
            <h2 id="access" className="section-title">
              What Codeceipt reads from GitHub
            </h2>
            <ul className="facts-list">
              <li>
                <strong>Your public profile:</strong> name, login and avatar, to show who is signed
                in.
              </li>
              <li>
                <strong>Your email address:</strong> to tell your account apart and to reach you
                about the beta.
              </li>
              <li>
                <strong>No repository access.</strong> Signing in cannot read or change your code.
                Your code is read on your own machine by <code>npx codeceipt</code>; the optional
                GitHub App only gets read access to the repositories you pick.
              </li>
            </ul>
          </section>
          <p className="muted m0">
            By signing in you agree to the <Link href="/terms">Terms</Link>. The{" "}
            <Link href="/privacy">Privacy page</Link> lists everything we store and how to delete
            it.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
