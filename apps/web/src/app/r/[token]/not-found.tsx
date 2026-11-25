import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import Link from "next/link";

// FEAT-038: a share link that no longer works (revoked, mistyped or never made). It says what to do: ask the person
// who sent it for a new one. Nothing about the receipt or its project is shown, and the reason is never given.
export default function DeadShareLink() {
  return (
    <div className="lp">
      <SiteHeader home="/" />
      <main id="content" className="page page-narrow">
        <div className="not-found" data-testid="dead-share-link">
          <p className="not-found-code mono" aria-hidden="true">
            404
          </p>
          <h1>This receipt link does not work anymore</h1>
          <p className="purpose">
            The person who shared it may have turned the link off, or the address is incomplete. Ask
            them to send you a new link.
          </p>
          <div className="row">
            <Link className="btn btn-primary" href="/">
              What is Codeceipt?
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
