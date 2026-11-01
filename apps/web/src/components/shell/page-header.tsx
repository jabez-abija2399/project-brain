import Link from "next/link";
import type { ReactNode } from "react";

export type Crumb = { label: string; href?: string };

/** Breadcrumbs: links up the path, the current page last (not a link). */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        {crumbs.map((c, i) => (
          <li key={`${c.label}-${i}`}>
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href}>{c.label}</Link>
            ) : (
              <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// Every page starts the same way: where you are, the title, one sentence on what the page is for, and at most one
// primary action.
export function PageHeader({
  crumbs,
  title,
  purpose,
  action,
}: {
  crumbs?: Crumb[];
  title: ReactNode;
  purpose: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      {crumbs && crumbs.length > 0 ? <Breadcrumbs crumbs={crumbs} /> : null}
      <div className="page-header-row">
        <div className="page-header-text">
          <h1 className="wrap">{title}</h1>
          <p className="purpose">{purpose}</p>
        </div>
        {action ? <div className="page-header-action">{action}</div> : null}
      </div>
    </div>
  );
}
