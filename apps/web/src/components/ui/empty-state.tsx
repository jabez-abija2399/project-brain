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
    <div className="card" data-testid="empty-state" style={{ textAlign: "center", padding: 32 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>{title}</h2>
      <p className="muted" style={{ margin: "0 0 16px" }}>
        {text}
      </p>
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
