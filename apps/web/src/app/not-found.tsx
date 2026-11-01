import { SiteFooter } from "@/components/landing/site-footer";
import { BareHeader } from "@/components/shell/app-shell";
import Link from "next/link";

// One 404 page for anything the visitor may not see: missing, or another user's (never "forbidden"). Same header
// and footer as the app, but nothing loaded for the visitor (it renders the same for everyone), and one way back.
export default function NotFound() {
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
            This page does not exist, or you do not have access to it. Check the address, or go back
            to your projects.
          </p>
          <div className="row">
            <Link className="btn btn-primary" href="/projects?all=1">
              Go to your projects
            </Link>
            <Link className="btn btn-ghost" href="/">
              Home
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter signedIn />
    </div>
  );
}
