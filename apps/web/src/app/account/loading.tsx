import { Skeleton } from "@/components/ui/skeleton";

// Loading state: a title, a line of text and a list, so the page does not jump when the data arrives.
export default function Loading() {
  return (
    <main className="page stack stack-lg" aria-busy="true">
      <span className="lp-visually-hidden">Loading…</span>
      <div className="stack gap-12">
        <Skeleton className="skeleton-title" />
        <Skeleton className="skeleton-line" />
      </div>
      <Skeleton className="skeleton-panel" />
    </main>
  );
}
