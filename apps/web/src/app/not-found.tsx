import { SiteFooter } from "@/components/landing/site-footer";
import { BareHeader } from "@/components/shell/app-shell";
import { isSignedIn } from "@/server/signed-in";
import Link from "next/link";

// One 404 page for anything the visitor may not see: missing, or another user's (never "forbidden"). Same header
// and footer as the app, and one way back. FEAT-038: that way back is Home for a signed-out visitor (they have no
// projects) and their projects for a signed-in one; the page says the same thing to both.
export default async function NotFound() {
  const signedIn = await isSignedIn();
  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <BareHeader />
      <main id="content" className="shell-body page page-narrow">
        <div className="not-found">
          <p className="not-found-code mono" aria-hidden="true">
            404
          </p>
          <h1>Page not found</h1>
          <p className="purpose">
            This page does not exist, or you do not have access to it. Check the address, or use the
            button below to go back.
          </p>
          <div className="row">
            {signedIn ? (
              <>
                <Link className="btn btn-primary" href="/projects?all=1">
                  Go to your projects
                </Link>
                <Link className="btn btn-ghost" href="/">
                  Home
                </Link>
              </>
            ) : (
              <Link className="btn btn-primary" href="/" data-testid="not-found-home">
                Home
              </Link>
            )}
          </div>
        </div>
      </main>
      <SiteFooter signedIn={signedIn} />
    </div>
  );
}
