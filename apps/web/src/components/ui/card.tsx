import type { ReactNode } from "react";

export function Card({
  highlighted = false,
  children,
  as: Tag = "div",
}: {
  highlighted?: boolean;
  children: ReactNode;
  as?: "div" | "li" | "article";
}) {
  return <Tag className={`card${highlighted ? " card-highlighted" : ""}`}>{children}</Tag>;
}
