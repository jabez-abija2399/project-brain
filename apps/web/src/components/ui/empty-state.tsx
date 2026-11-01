import Link from "next/link";
import type { ReactNode } from "react";

// Empty lists say what is missing and offer exactly one next step (docs/DESIGN.md).
export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action: { label: string; href: string } | ReactNode;
}) {
  return (
    <div className="empty" data-testid="empty-state">
      <h2 className="section-title">{title}</h2>
      <p className="muted">{text}</p>
      {action && typeof action === "object" && "href" in action ? (
        <Link className="btn btn-primary" href={action.href}>
          {action.label}
        </Link>
      ) : (
        action
      )}
    </div>
  );
}
