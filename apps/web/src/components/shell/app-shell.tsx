import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import Link from "next/link";
import type { ReactNode } from "react";
import { ProjectSwitcher, type SwitcherProject } from "./project-switcher";
import { UserMenu } from "./user-menu";

/** The app header with nothing personal in it (the 404 page): wordmark, Docs and Projects. */
export function BareHeader() {
  return (
    <header className="app-header">
      <div className="app-header-row">
        <Link className="lp-wordmark" href="/">
          Codeceipt
        </Link>
        <span className="app-header-end">
          <Link className="app-header-link" href="/docs/quickstart">
            Docs
          </Link>
          <Link className="app-header-link" href="/projects?all=1">
            Projects
          </Link>
        </span>
      </div>
    </header>
  );
}

// The shared app shell (2026-11-01): a skip link, the header (wordmark, project switcher, who is signed in, sign
// out), the page, and the same footer as the landing page. Signed out, it shows the public header instead. Only the
// signed-in user's own projects are listed; app/shell-layout.tsx loads them (server/shell.ts).
export function AppShell({
  user,
  projects,
  celebrate = true,
  children,
}: {
  user: { name: string; email: string } | null;
  projects: SwitcherProject[];
  celebrate?: boolean;
  children: ReactNode;
}) {
  if (!user) {
    return (
      <div className="shell">
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        <SiteHeader home="/" />
        <div id="content" className="shell-body">
          {children}
        </div>
        <SiteFooter />
      </div>
    );
  }
  return (
    <div className="shell" data-celebrate={celebrate ? "on" : "off"}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header-row">
          <Link className="lp-wordmark" href="/projects?all=1" aria-label="Codeceipt: all projects">
            Codeceipt
          </Link>
          {projects.length > 0 ? <ProjectSwitcher projects={projects} /> : null}
          <span className="app-header-end">
            <Link className="app-header-link" href="/docs/quickstart">
              Docs
            </Link>
            {/* Real-test D: a GitHub account without a display name still gets a visible, named menu. */}
            <UserMenu name={user.name} email={user.email} />
          </span>
        </div>
      </header>
      <div id="content" className="shell-body">
        {children}
      </div>
      <SiteFooter signedIn />
    </div>
  );
}
