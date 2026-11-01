import { ProjectHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

// Loading state for the feature board: the summary strip, the toolbar and six table rows.
export default function FeaturesLoading() {
  return (
    <main className="page stack gap-20" aria-busy="true">
      <span className="lp-visually-hidden">Loading features…</span>
      <ProjectHeaderSkeleton />
      <div className="stat-grid">
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} style={{ height: 72, borderRadius: 12 }} />
        ))}
      </div>
      <Skeleton style={{ width: "min(560px, 100%)", height: 34, borderRadius: 999 }} />
      <div className="card stack gap-14">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="row skeleton-row between">
            <Skeleton style={{ width: "30%", height: 16 }} />
            <Skeleton style={{ width: "25%", height: 8, borderRadius: 999 }} />
            <Skeleton style={{ width: 70, height: 20, borderRadius: 999 }} />
          </div>
        ))}
      </div>
    </main>
  );
}
