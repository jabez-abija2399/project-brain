"use client";

import SignInButton from "@/app/sign-in-button";
import { useEffect, useState } from "react";

// Landing page header. On phones the links fold into a menu button.
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  // Following one of the page's links (a hash change) closes the menu.
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);
  return (
    <header className="lp-header">
      <div className="lp-container lp-header-row">
        <a className="lp-wordmark" href="#top">
          Project Brain
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
          <a href="#how">How it works</a>
          <a href="#privacy">Privacy</a>
          <a href="#faq">FAQ</a>
          <SignInButton variant="link" />
          <a className="btn btn-primary" href="#join">
            Join the beta
          </a>
        </nav>
      </div>
    </header>
  );
}
