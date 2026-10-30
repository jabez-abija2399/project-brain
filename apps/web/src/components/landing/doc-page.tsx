import type { ReactNode } from "react";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

// A plain reading page (privacy, terms, docs) with the landing page's header and footer.
export function DocPage({
  title,
  updated,
  children,
}: { title: string; updated?: string; children: ReactNode }) {
  return (
    <div className="lp" id="top">
      <SiteHeader home="/" />
      <main className="lp-container lp-section lp-doc">
        <h1>{title}</h1>
        {updated ? <p className="lp-doc-updated">Last updated {updated}</p> : null}
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
