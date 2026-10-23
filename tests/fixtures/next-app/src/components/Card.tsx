import type { ReactNode } from "react";
import { formatTitle } from "@/lib/utils";

type CardProps = { title: string; children: ReactNode };

export const Card = ({ title, children }: CardProps) => {
  return (
    <section>
      <h2>{formatTitle(title)}</h2>
      {children}
    </section>
  );
};
