import { ProjectHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

// Loading state for every project page: a skeleton shaped like the overview (headline, four numbers, two panels), so
// the page does not jump when the data arrives. Screen readers hear "Loading project".
export default function Loading() {
  return (
    <main className="page stack" aria-busy="true" style={{ gap: 24 }}>
      <span className="lp-visually-hidden">Loading project…</span>
      <ProjectHeaderSkeleton />
      <Skeleton style={{ width: "min(440px, 100%)", height: 28 }} />
      <div className="stat-grid">
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} className="skeleton-stat" />
        ))}
      </div>
      <div className="overview-grid">
        <Skeleton className="skeleton-panel" />
        <Skeleton className="skeleton-panel" />
      </div>
    </main>
  );
}
