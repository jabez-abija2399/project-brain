import { SiteFooter } from "@/components/landing/site-footer";
import { BareHeader } from "@/components/shell/app-shell";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Suspended | Codeceipt", robots: { index: false } };

// Where a suspended account or project lands (2026-11-01): what happened, what still works, what to do.
export default async function SuspendedPage({
  searchParams,
}: {
  searchParams: Promise<{ what?: string | string[] }>;
}) {
  const project = (await searchParams).what === "project";
  return (
    <div className="shell">
      <BareHeader />
      <main id="content" className="shell-body page page-narrow">
        <div className="not-found">
          <h1>{project ? "This project is suspended" : "Your account is suspended"}</h1>
          <p className="purpose">
            {project
              ? "Codeceipt suspended this project. Its pages, CLI and MCP access do not work until it is restored."
              : "Codeceipt suspended your account. The dashboard, the CLI and MCP do not work until it is restored."}{" "}
            Reply to any email from Codeceipt or contact support to ask why and to restore it.
          </p>
          <p className="muted m0">You can still export your data on the Account page.</p>
          <div className="row">
            <Link className="btn btn-primary" href="/account">
              Go to your account
            </Link>
            <Link className="btn btn-ghost" href="/privacy">
              Privacy
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter signedIn />
    </div>
  );
}
