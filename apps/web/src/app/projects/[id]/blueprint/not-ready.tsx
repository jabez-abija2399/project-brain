import { EmptyState } from "@/components/ui/empty-state";
import type { ReactNode } from "react";

// The Blueprint pages before the Blueprint is set up for this project (or with nothing to show yet): the project
// header and one empty state with one way on.
export function BlueprintEmpty({
  nav,
  title = "The Blueprint is being set up",
  text,
  action,
}: {
  nav: ReactNode;
  title?: string;
  text: string;
  action: { label: string; href: string };
}) {
  return (
    <main className="page stack stack-lg">
      <div>{nav}</div>
      <EmptyState title={title} text={text} action={action} />
    </main>
  );
}
