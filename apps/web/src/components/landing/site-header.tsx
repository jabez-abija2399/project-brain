"use client";

import { useEffect, useState } from "react";

// The public header: wordmark, Docs, Privacy, Sign in and one primary button. Sticky and compact; on phones the
// links fold into a menu button. Other public pages pass home="/" so the links lead back to the landing page.
export function SiteHeader({ home = "" }: { home?: "" | "/" }) {
  const [open, setOpen] = useState(false);
  // Following one of the page's links (a hash change) or pressing Escape closes the menu.
  useEffect(() => {
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("hashchange", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("hashchange", close);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <header className="lp-header">
      <div className="lp-container lp-header-row">
        <a className="lp-wordmark" href={home === "/" ? "/" : "#top"}>
          Codeceipt
        </a>
        <button
          type="button"
          className="btn btn-ghost lp-menu-button"
          aria-expanded={open}
          aria-controls="lp-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close menu" : "Menu"}
        </button>
        <nav id="lp-nav" className="lp-nav" aria-label="Main" data-open={open ? "true" : "false"}>
          <a href="/docs/quickstart">Docs</a>
          <a href="/privacy">Privacy</a>
          <a href="/sign-in">Sign in</a>
          <a className="btn btn-primary" href={`${home}#get-started`}>
            Get started
          </a>
        </nav>
      </div>
    </header>
  );
}
